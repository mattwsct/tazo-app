import { NextRequest } from 'next/server';
import { kv } from '@vercel/kv';
import { verifyAuth } from '@/lib/api-auth';
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
  
  // Check authentication but don't require it
  let isAuthenticated = false;
  try {
    isAuthenticated = await verifyAuth();
  } catch {
    console.log('SSE: Auth check failed, treating as unauthenticated');
  }
  
  // Always allow access to SSE, authenticated or not
  if (!isAuthenticated) {
    console.log('SSE: Not authenticated, will use default settings');
  }

  const encoder = new TextEncoder();
  
  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      let lastModified = 0;
      const connectionId = `sse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`[SSE] New connection established: ${connectionId} (authenticated: ${isAuthenticated})`);
      
      // Register this connection with the broadcast system
      addConnection(controller, connectionId);
      
      console.log(`[SSE] Connection ${connectionId} registered with broadcast system`);
      
      // Log connection status after a short delay to verify registration
      setTimeout(() => {
        const connectionInfo = getConnectionInfo();
        console.log(`[SSE] Connection ${connectionId} status check - registered: ${connectionInfo.ids.includes(connectionId)}, total: ${connectionInfo.count}`);
        console.log(`[SSE] All connections:`, connectionInfo.ids);
      }, 200);
      
      // Function to send SSE data
      const sendSSE = (data: string) => {
        try {
          // Check if connection is still valid before sending
          if (connections.has(connectionId)) {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } else {
            console.log(`[SSE] Connection ${connectionId} no longer exists, skipping send`);
          }
        } catch (error) {
          console.error(`[SSE] Failed to send data to ${connectionId}:`, error);
          // Remove dead connection
          removeConnection(connectionId);
        }
      };
      
      // Function to check for settings updates
      const checkForUpdates = async () => {
        try {
          if (!isAuthenticated) {
            // Send heartbeat for unauthenticated connections
            sendSSE(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
            return;
          }
          
          // Get both settings and modification timestamp
          const [settings, modifiedTimestamp] = await Promise.all([
            kv.get('overlay_settings'),
            kv.get('overlay_settings_modified')
          ]);
          
          if (settings && typeof settings === 'object' && modifiedTimestamp) {
            const currentModified = modifiedTimestamp as number;
            
            if (currentModified > lastModified) {
              lastModified = currentModified;
              
              // Send settings with proper format
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
      
      // Send current settings immediately if authenticated
      if (isAuthenticated) {
        // Small delay to ensure connection is fully established
        setTimeout(() => {
          checkForUpdates();
        }, 100);
      }
      
      // Check for updates every 2 seconds
      const interval = setInterval(checkForUpdates, 2000);
      
      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        console.log(`[SSE] Connection closed: ${connectionId}`);
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
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
} 