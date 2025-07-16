import { OverlaySettings, SettingsUpdateMessage } from '@/types/settings';

// Store active connections with better tracking
interface ConnectionInfo {
  controller: ReadableStreamDefaultController;
  id: string;
  connectedAt: number;
}

const connections = new Map<string, ConnectionInfo>();

export function addConnection(controller: ReadableStreamDefaultController, id?: string): string {
  const connectionId = id || `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  connections.set(connectionId, {
    controller,
    id: connectionId,
    connectedAt: Date.now()
  });
  console.log(`[BROADCAST] Added connection ${connectionId}, total: ${connections.size}`);
  return connectionId;
}

export function removeConnection(connectionId: string) {
  const removed = connections.delete(connectionId);
  console.log(`[BROADCAST] Removed connection ${connectionId}, success: ${removed}, remaining: ${connections.size}`);
}

export function getConnectionCount(): number {
  return connections.size;
}

// Function to broadcast settings to all connected clients
export async function broadcastSettings(settings: OverlaySettings) {
  const encoder = new TextEncoder();
  const broadcastData: SettingsUpdateMessage & OverlaySettings = {
    ...settings,
    timestamp: Date.now(),
    type: 'settings_update'
  };
  const data = JSON.stringify(broadcastData);
  
  console.log(`[BROADCAST] Starting broadcast to ${connections.size} connected clients:`, broadcastData);
  
  if (connections.size === 0) {
    console.warn(`[BROADCAST] ⚠️  No active SSE connections! Settings update will be lost unless overlay polls.`);
    return { success: false, reason: 'no_connections' };
  }
  
  let successCount = 0;
  let failureCount = 0;
  const deadConnections: string[] = [];
  
  connections.forEach((connectionInfo, connectionId) => {
    try {
      connectionInfo.controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      successCount++;
      console.log(`[BROADCAST] ✅ Sent to connection ${connectionId}`);
    } catch (error) {
      // Connection closed, mark for removal
      deadConnections.push(connectionId);
      failureCount++;
      console.log(`[BROADCAST] ❌ Dead connection ${connectionId}:`, error);
    }
  });

  // Clean up dead connections
  deadConnections.forEach(connectionId => {
    connections.delete(connectionId);
  });
  
  console.log(`[BROADCAST] Complete: ${successCount} successful, ${failureCount} failed, ${connections.size} remaining active connections`);
  
  return { 
    success: successCount > 0, 
    successCount, 
    failureCount, 
    activeConnections: connections.size 
  };
}

// Send heartbeat to all connections
export function sendHeartbeat() {
  const encoder = new TextEncoder();
  const heartbeatData = {
    type: 'heartbeat',
    timestamp: Date.now()
  };
  const data = JSON.stringify(heartbeatData);
  
  const deadConnections: string[] = [];
  
  connections.forEach((connectionInfo, connectionId) => {
    try {
      connectionInfo.controller.enqueue(encoder.encode(`data: ${data}\n\n`));
    } catch {
      deadConnections.push(connectionId);
    }
  });

  // Clean up dead connections
  deadConnections.forEach(connectionId => {
    connections.delete(connectionId);
  });

  if (deadConnections.length > 0) {
    console.log(`[HEARTBEAT] Cleaned up ${deadConnections.length} dead connections, ${connections.size} remaining`);
  }
} 