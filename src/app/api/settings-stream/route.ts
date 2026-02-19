import { NextRequest } from 'next/server';
import { kv } from '@vercel/kv';
import { addConnection, removeConnection, getConnectionInfo, connections } from '@/lib/settings-broadcast';
import { POLL_STATE_KEY, POLL_MODIFIED_KEY } from '@/types/poll';

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
        try {
          const [settings, settingsModified, pollState, pollModified] = await kv.mget([
            'overlay_settings',
            'overlay_settings_modified',
            POLL_STATE_KEY,
            POLL_MODIFIED_KEY,
          ]);
          const settingsTs = (settingsModified as number) ?? 0;
          const pollTs = (pollModified as number) ?? 0;
          const maxTs = Math.max(settingsTs, pollTs);
          const shouldSend = lastModified === 0 || maxTs > lastModified;
          if (shouldSend) {
            lastModified = maxTs;
            const settingsUpdate = {
              ...(settings && typeof settings === 'object' ? settings : {}),
              pollState: pollState ?? null,
              type: 'settings_update',
              timestamp: maxTs,
            };
            sendSSE(JSON.stringify(settingsUpdate));
          }
        } catch (error) {
          console.error('Error checking settings:', error);
        }
      };
      
      // Send initial connection message and current settings
      sendSSE(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
      
      // Send current settings immediately (allow unauthenticated read access)
        // Small delay to ensure connection is fully established
        setTimeout(() => {
          checkForUpdates();
        }, 100);
      
      // Check every 15s to reduce KV ops (was 10s; 1 mget per check)
      const interval = setInterval(checkForUpdates, 15000);
      
      // Cleanup on close
      request.signal.addEventListener('abort', () => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[SSE] Connection closed: ${connectionId}`);
      }
        clearInterval(interval);
        removeConnection(connectionId);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      // If credentials are needed, specify exact origin; otherwise omit credentials header.
      'Access-Control-Allow-Origin': '*'
    },
  });
} 