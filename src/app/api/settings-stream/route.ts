import { kv } from '@vercel/kv';
import { NextRequest } from 'next/server';
import { addConnection, removeConnection } from '@/lib/settings-broadcast';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';

async function handleGET(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      console.log('[SSE] New connection established');
      const connectionId = addConnection(controller);
      console.log(`[SSE] Connection ${connectionId} added to broadcast pool`);
      
      // Send initial settings
      kv.get('overlay_settings').then(settings => {
        const initialSettings = settings || DEFAULT_OVERLAY_SETTINGS;
        const data = JSON.stringify(initialSettings);
        console.log(`[SSE] Sending initial settings to ${connectionId}:`, initialSettings);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }).catch(error => {
        console.error(`[SSE] Failed to load initial settings for ${connectionId}:`, error);
        // Send default settings if KV fails
        const defaultData = JSON.stringify(DEFAULT_OVERLAY_SETTINGS);
        controller.enqueue(encoder.encode(`data: ${defaultData}\n\n`));
      });
      
      // Keep connection alive with more frequent heartbeat
      const heartbeat = setInterval(() => {
        try {
          const heartbeatData = {
            type: 'heartbeat',
            timestamp: Date.now()
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(heartbeatData)}\n\n`));
        } catch (error) {
          console.log(`[SSE] Heartbeat failed for ${connectionId}, cleaning up:`, error);
          clearInterval(heartbeat);
          removeConnection(connectionId);
        }
      }, 30000); // 30 second heartbeat - more frequent for better reliability
      
      // Clean up on close
      request.signal.addEventListener('abort', () => {
        console.log(`[SSE] Connection ${connectionId} closed, cleaning up`);
        clearInterval(heartbeat);
        removeConnection(connectionId);
        console.log(`[SSE] Connection ${connectionId} removed from broadcast pool`);
        try {
          controller.close();
        } catch {
          // Controller already closed
        }
      });
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
}

// Custom auth wrapper for streaming responses
async function GET_WITH_AUTH(request: NextRequest) {
  // Skip auth for OPTIONS requests (CORS preflight)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200 });
  }

  // Import auth function locally to avoid circular dependencies
  const { validateApiSecret } = await import('@/lib/api-auth');
  
  // Check for authentication in headers first
  let isAuthenticated = validateApiSecret(request);
  
  // If no header auth, check URL parameter (for EventSource compatibility)
  if (!isAuthenticated) {
    const url = new URL(request.url);
    const secretParam = url.searchParams.get('secret');
    const API_SECRET = process.env.API_SECRET || 'fallback-dev-secret-change-in-production';
    isAuthenticated = secretParam === API_SECRET;
  }
  
  if (!isAuthenticated) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid or missing API secret' }),
      { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  return handleGET(request);
}

export { GET_WITH_AUTH as GET }; 