import { NextRequest } from 'next/server';
import { kv } from '@vercel/kv';
import { addConnection, removeConnection, getConnectionInfo, connections } from '@/lib/settings-broadcast';

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
      
      // Function to check for settings updates
      // Allow unauthenticated read access for overlay (public read-only access)
      const checkForUpdates = async () => {
        try {
          // Get both settings and modification timestamp
          // Allow unauthenticated access - this is read-only, so it's safe
          const [settings, modifiedTimestamp] = await Promise.all([
            kv.get('overlay_settings'),
            kv.get('overlay_settings_modified')
          ]);
          
          if (settings && typeof settings === 'object' && modifiedTimestamp) {
            const currentModified = modifiedTimestamp as number;
            
            if (currentModified > lastModified) {
              lastModified = currentModified;
              
              // Send settings with proper format
              // This is read-only access - unauthenticated users can receive but not modify
              const settingsUpdate = {
                ...settings,
                type: 'settings_update',
                timestamp: currentModified
              };
              
              sendSSE(JSON.stringify(settingsUpdate));
            }
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
      
      // Check for updates every 2 seconds for more responsive updates
      const interval = setInterval(checkForUpdates, 2000);
      
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