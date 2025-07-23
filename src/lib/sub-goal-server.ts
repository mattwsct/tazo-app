import { OverlayLogger } from './logger';

interface SubGoalData {
  currentSubs: number;
  currentGoal: number;
  latestSub: {
    type: 'subscription' | 'resub' | 'gift';
    username: string;
    months?: number;
    giftCount?: number;
    timestamp: number;
  } | null;
  lastSubTime: number;
  isStreamActive: boolean;
  streamEndTime: number | null;
}

interface SSEClient {
  id: string;
  channel: string;
  send: (data: string) => void;
  close: () => void;
}

class SubGoalServer {
  private subGoalData: Map<string, SubGoalData> = new Map();
  private sseClients: Set<SSEClient> = new Set();
  private streamEndTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    // No longer need timeout checker since we reset on stream start
  }

  public handleStreamEvent(channel: string, eventType: 'stream_start' | 'stream_stop') {
    if (eventType === 'stream_start') {
      this.handleStreamStart(channel);
    } else if (eventType === 'stream_stop') {
      this.handleStreamEnd(channel);
    }
  }

  private handleStreamStart(channel: string) {
    // Clear any existing timeout
    this.clearStreamTimeout(channel);
    
    // Update sub goal data
    const data = this.getOrCreateSubGoalData(channel);
    const now = Date.now();
    
    // Check if we should reset based on time since last stream end
    const shouldReset = this.shouldResetOnStreamStart(data, now);
    
    if (shouldReset) {
      // Reset sub count and leaderboard, but keep latest sub
      const latestSub = data.latestSub; // Preserve latest sub
      data.currentSubs = 0;
      data.streamEndTime = null;
      data.isStreamActive = true;
      data.latestSub = latestSub; // Keep the latest sub for continuity
      
      OverlayLogger.overlay(`Stream started for ${channel} - resetting sub goal (1+ hour since last stream)`, {
        timeSinceLastStream: this.getTimeSinceLastStream(data),
        latestSub: latestSub?.username || 'None'
      });
    } else {
      // Just activate the stream without resetting
      data.isStreamActive = true;
      data.streamEndTime = null;
      
      OverlayLogger.overlay(`Stream started for ${channel} - continuing sub goal tracking`, {
        timeSinceLastStream: this.getTimeSinceLastStream(data),
        currentSubs: data.currentSubs
      });
    }
    
    this.broadcastUpdate(channel, 'stream_start', data);
  }

  private handleStreamEnd(channel: string) {
    const now = Date.now();
    const data = this.getOrCreateSubGoalData(channel);
    
    // Update sub goal data - just record when stream ended
    data.isStreamActive = false;
    data.streamEndTime = now;
    
    // Clear any existing timeout (no longer needed)
    this.clearStreamTimeout(channel);
    
    OverlayLogger.overlay(`Stream ended for ${channel} - sub goal data preserved`, {
      currentSubs: data.currentSubs,
      latestSub: data.latestSub?.username || 'None'
    });
    
    this.broadcastUpdate(channel, 'stream_stop', data);
  }

  private clearStreamTimeout(channel: string) {
    const timeoutId = this.streamEndTimeouts.get(channel);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.streamEndTimeouts.delete(channel);
    }
  }

  public getSubGoalData(channel: string): SubGoalData | null {
    return this.subGoalData.get(channel) || null;
  }

  public updateSubGoalData(channel: string, updates: Partial<SubGoalData>) {
    const data = this.getOrCreateSubGoalData(channel);
    Object.assign(data, updates);
    
    // Broadcast update to clients
    this.broadcastUpdate(channel, 'data_update', data);
  }

  public updateSubCount(channel: string, count: number) {
    console.log('SubGoalServer - updateSubCount called:', { channel, count });
    const data = this.getOrCreateSubGoalData(channel);
    data.currentSubs = count;
    data.lastSubTime = Date.now();
    
    console.log('SubGoalServer - Broadcasting update to clients:', { channel, clientCount: this.sseClients.size });
    // Broadcast update to clients
    this.broadcastUpdate(channel, 'data_update', data);
  }

  public updateLatestSub(channel: string, username: string) {
    const data = this.getOrCreateSubGoalData(channel);
    data.latestSub = {
      type: 'subscription',
      username: username,
      timestamp: Date.now()
    };
    data.lastSubTime = Date.now();
    
    // Broadcast update to clients
    this.broadcastUpdate(channel, 'data_update', data);
  }

  public resetSubGoal(channel: string) {
    const data = this.getOrCreateSubGoalData(channel);
    data.currentSubs = 0;
    data.latestSub = null;
    data.lastSubTime = Date.now();
    
    // Broadcast update to clients
    this.broadcastUpdate(channel, 'data_update', data);
  }

  private getOrCreateSubGoalData(channel: string): SubGoalData {
    if (!this.subGoalData.has(channel)) {
      this.subGoalData.set(channel, {
        currentSubs: 0,
        currentGoal: 10, // Default goal
        latestSub: null,
        lastSubTime: 0,
        streamEndTime: null,
        isStreamActive: false
      });
    }
    return this.subGoalData.get(channel)!;
  }

  public addClient(id: string, channel: string, send: (data: string) => void, close: () => void) {
    const client: SSEClient = { id, channel, send, close };
    this.sseClients.add(client);
    
    // Send current data to new client
    const data = this.getSubGoalData(channel);
    if (data) {
      send(`data: ${JSON.stringify({ type: 'initial_data', data })}\n\n`);
    }
    
    OverlayLogger.overlay(`Client ${id} connected to sub goal events for ${channel}`);
  }

  public removeClient(id: string) {
    this.sseClients.forEach(client => {
      if (client.id === id) {
        this.sseClients.delete(client);
        OverlayLogger.overlay(`Client ${id} disconnected from sub goal events`);
      }
    });
  }

  private broadcastUpdate(channel: string, eventType: string, data: SubGoalData) {
    const message = `data: ${JSON.stringify({ type: eventType, data })}\n\n`;
    
    console.log('SubGoalServer - Broadcasting message:', { channel, eventType, clientCount: this.sseClients.size });
    
    this.sseClients.forEach(client => {
      console.log('SubGoalServer - Checking client:', { clientId: client.id, clientChannel: client.channel, targetChannel: channel });
      if (client.channel === channel) {
        try {
          console.log('SubGoalServer - Sending to client:', client.id);
          client.send(message);
        } catch (error) {
          OverlayLogger.error(`Failed to send update to client ${client.id}:`, error);
          this.sseClients.delete(client);
        }
      }
    });
  }

  public getStatus() {
    return {
      channels: Array.from(this.subGoalData.keys()),
      activeTimeouts: Array.from(this.streamEndTimeouts.keys()),
      clientCount: this.sseClients.size,
      clients: Array.from(this.sseClients).map(c => ({ id: c.id, channel: c.channel }))
    };
  }

  public cleanup() {
    // Clear all timeouts
    this.streamEndTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this.streamEndTimeouts.clear();
    this.sseClients.clear();
  }

  private shouldResetOnStreamStart(data: SubGoalData, now: number): boolean {
    // If no stream end time recorded, don't reset (first time)
    if (!data.streamEndTime) {
      return false;
    }
    
    // If stream is currently active, don't reset
    if (data.isStreamActive) {
      return false;
    }
    
    // Check if it's been more than 1 hour since stream end
    const timeSinceStreamEnd = now - data.streamEndTime;
    const oneHourInMs = 60 * 60 * 1000;
    
    return timeSinceStreamEnd > oneHourInMs;
  }

  private getTimeSinceLastStream(data: SubGoalData): string {
    if (!data.streamEndTime) {
      return 'No previous stream recorded';
    }
    
    const now = Date.now();
    const timeSinceStreamEnd = now - data.streamEndTime;
    const hours = Math.floor(timeSinceStreamEnd / (60 * 60 * 1000));
    const minutes = Math.floor((timeSinceStreamEnd % (60 * 60 * 1000)) / (60 * 1000));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ago`;
    } else {
      return `${minutes}m ago`;
    }
  }
}

// Create singleton instance
let subGoalServerInstance: SubGoalServer | null = null;

export function getSubGoalServer(): SubGoalServer {
  if (!subGoalServerInstance) {
    subGoalServerInstance = new SubGoalServer();
  }
  return subGoalServerInstance;
}

export function cleanupSubGoalServer() {
  if (subGoalServerInstance) {
    subGoalServerInstance.cleanup();
    subGoalServerInstance = null;
  }
} 