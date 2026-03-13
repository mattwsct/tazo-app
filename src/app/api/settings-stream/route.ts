import { NextRequest } from 'next/server';
import { kv } from '@/lib/kv';
import { addConnection, removeConnection, getConnectionInfo, connections } from '@/lib/settings-broadcast';
import { POLL_STATE_KEY, POLL_MODIFIED_KEY } from '@/types/poll';
import { TRIVIA_STATE_KEY, TRIVIA_MODIFIED_KEY } from '@/types/trivia';
import { STREAM_GOALS_MODIFIED_KEY, getStreamGoals } from '@/utils/stream-goals-storage';
import { getRecentAlerts } from '@/utils/overlay-alerts-storage';
import { getOverlayTimers } from '@/utils/overlay-timer-storage';
import { CHALLENGES_MODIFIED_KEY, getChallenges, getWallet } from '@/utils/challenges-storage';
import { tickTrivia } from '@/lib/trivia-webhook-handler';

// === 📡 SERVER-SENT EVENTS STREAM ===
export async function GET(request: NextRequest): Promise<Response> {
  // Check if this is a status check request
  const url = new URL(request.url);
  if (url.searchParams.get('status') === 'check') {
    const connectionInfo = getConnectionInfo();
    return Response.json({
      connections: connectionInfo.count,
      ids: connectionInfo.ids,
      timestamp: Date.now()
    });
  }
  
  // Allow public read-only access to settings stream (overlay needs this)
  // Authentication is not required - this endpoint is read-only and safe for public access

  const encoder = new TextEncoder();
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      let lastModified = 0;
      let lastGoalsModified = 0;
      let lastChallengesModified = 0;
      const connectionId = `sse_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[SSE] New connection established: ${connectionId}`);
      }
      
      // Register this connection with the broadcast system
      addConnection(controller, connectionId);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[SSE] Connection ${connectionId} registered with broadcast system`);
      }
      
      // Log connection status after a short delay to verify registration (only for first few connections)
      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => {
          const connectionInfo = getConnectionInfo();
          if (connectionInfo.count <= 3) {
            console.log(`[SSE] Connection ${connectionId} status check - registered: ${connectionInfo.ids.includes(connectionId)}, total: ${connectionInfo.count}`);
          }
        }, 200);
      }
      
      // Function to send SSE data
      const sendSSE = (data: string) => {
        try {
          // Check if connection is still valid before sending
          if (connections.has(connectionId)) {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } else {
            if (process.env.NODE_ENV === 'development') {
              console.log(`[SSE] Connection ${connectionId} no longer exists, skipping send`);
            }
          }
        } catch (error) {
          if (process.env.NODE_ENV === 'development') {
            console.error(`[SSE] Failed to send data to ${connectionId}:`, error);
          }
          // Remove dead connection
          removeConnection(connectionId);
        }
      };
      
      // Throttle trivia ticks to once every 5s (called from 1s poll loop).
      let lastTriviaTickAt = 0;

      // Function to check for settings and poll updates.
      // Two-phase: phase 1 reads only modification timestamps (1 cheap KV command).
      // Phase 2 (full data fetch) runs only when something actually changed.
      const checkForUpdates = async () => {
        const now = Date.now();
        if (now - lastTriviaTickAt >= 5000) {
          lastTriviaTickAt = now;
          void tickTrivia().catch(() => {});
        }
        try {
          // Phase 1: cheap — only 5 small timestamp values, 1 KV command.
          const [settingsModified, pollModified, triviaModified, goalsModified, challengesModified] = await kv.mget([
            'overlay_settings_modified',
            POLL_MODIFIED_KEY,
            TRIVIA_MODIFIED_KEY,
            STREAM_GOALS_MODIFIED_KEY,
            CHALLENGES_MODIFIED_KEY,
          ]);
          const settingsTs = (settingsModified as number) ?? 0;
          const pollTs = (pollModified as number) ?? 0;
          const triviaTs = (triviaModified as number) ?? 0;
          const goalsTs = (goalsModified as number) ?? 0;
          const challengesTs = (challengesModified as number) ?? 0;
          const maxTs = Math.max(settingsTs, pollTs, triviaTs);

          const settingsChanged = lastModified === 0 || maxTs > lastModified;
          const goalsChanged = goalsTs > lastGoalsModified;
          const challengesChanged = challengesTs > lastChallengesModified;

          if (!settingsChanged && !goalsChanged && !challengesChanged) return;

          // Phase 2: something changed — fetch full data.
          const [settings, pollState, triviaState] = await kv.mget([
            'overlay_settings',
            POLL_STATE_KEY,
            TRIVIA_STATE_KEY,
          ]);

          const sendData: Record<string, unknown> = {
            ...(settings && typeof settings === 'object' ? settings : {}),
            pollState: pollState ?? null,
            triviaState: triviaState ?? null,
            type: 'settings_update',
            timestamp: Math.max(maxTs, goalsTs),
          };

          if (settingsChanged) lastModified = maxTs;

          if (goalsChanged) {
            lastGoalsModified = goalsTs;
            const [streamGoals, overlayAlerts] = await Promise.all([
              getStreamGoals(),
              getRecentAlerts(),
            ]);
            sendData.streamGoals = streamGoals;
            sendData.overlayAlerts = overlayAlerts;
          }

          if (challengesChanged) lastChallengesModified = challengesTs;
          const [timerState, challengesState, walletState] = await Promise.all([
            getOverlayTimers(),
            getChallenges(),
            getWallet(),
          ]);
          sendData.timerState = timerState;
          sendData.challengesState = challengesState;
          sendData.walletState = walletState;

          sendSSE(JSON.stringify(sendData));
        } catch (error) {
          console.error('Error checking settings:', error);
        }
      };
      
      // Send initial connection message and current settings
      sendSSE(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
      
      // Send current settings immediately (allow unauthenticated read access)
      setTimeout(() => {
        checkForUpdates();
      }, 100);
      
      // Poll every 1s. On Vercel, each request runs in its own serverless instance so
      // broadcastSettings() from a webhook handler can't reach this connection's in-memory
      // controller. This 1s poll is the reliable path — it costs 1 KV command per tick
      // (just timestamp keys) and only fetches full data when something changed.
      const checkInterval = setInterval(checkForUpdates, 1000);
      
      // Heartbeat every 8s — must arrive before the 15s polling-fallback threshold
      const heartbeatInterval = setInterval(() => {
        sendSSE(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
      }, 8000);
      
      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[SSE] Connection closed: ${connectionId}`);
        }
        clearInterval(checkInterval);
        clearInterval(heartbeatInterval);
        removeConnection(connectionId);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Disable proxy/nginx buffering so each SSE frame is flushed immediately
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  });
} 