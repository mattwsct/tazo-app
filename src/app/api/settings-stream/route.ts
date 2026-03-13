import { NextRequest } from 'next/server';
import { kv } from '@/lib/kv';
import { addConnection, removeConnection, getConnectionInfo, connections } from '@/lib/settings-broadcast';
import { POLL_STATE_KEY, POLL_MODIFIED_KEY } from '@/types/poll';
import { TRIVIA_STATE_KEY, TRIVIA_MODIFIED_KEY } from '@/types/trivia';
import { STREAM_GOALS_MODIFIED_KEY, getStreamGoals } from '@/utils/stream-goals-storage';
import { getRecentAlerts } from '@/utils/overlay-alerts-storage';
import { getOverlayTimer } from '@/utils/overlay-timer-storage';
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
      
      // Function to check for settings and poll updates
      const checkForUpdates = async () => {
        // Fire-and-forget: expire trivia or send a reminder if due.
        void tickTrivia().catch(() => {});
        try {
          const [settings, settingsModified, pollState, pollModified, triviaState, triviaModified, goalsModified, challengesModified] = await kv.mget([
            'overlay_settings',
            'overlay_settings_modified',
            POLL_STATE_KEY,
            POLL_MODIFIED_KEY,
            TRIVIA_STATE_KEY,
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

          const sendData: Record<string, unknown> = {
            ...(settings && typeof settings === 'object' ? settings : {}),
            pollState: pollState ?? null,
            triviaState: triviaState ?? null,
            type: 'settings_update',
            timestamp: Math.max(maxTs, goalsTs),
          };

          if (settingsChanged) lastModified = maxTs;

          // When goals have changed, push live counts and recent alerts instantly.
          if (goalsChanged) {
            lastGoalsModified = goalsTs;
            const [streamGoals, overlayAlerts] = await Promise.all([
              getStreamGoals(),
              getRecentAlerts(),
            ]);
            // Include stream goals for overlay.
            sendData.streamGoals = streamGoals;
            // Recent alerts — overlay uses them for the 8s full-width alert display
            sendData.overlayAlerts = overlayAlerts;
          }

          // Challenges & wallet — include on every update (lightweight reads)
          if (challengesChanged) lastChallengesModified = challengesTs;
          const [timerState, challengesState, walletState] = await Promise.all([
            getOverlayTimer(),
            getChallenges(),
            getWallet(),
          ]);
          sendData.timerState = timerState ?? null;
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
      
      // Check every 15s as a safety net — explicit broadcastSettings() calls handle real-time
      // updates immediately, so this poll only catches cases where a broadcast fails.
      const checkInterval = setInterval(checkForUpdates, 15000);
      
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