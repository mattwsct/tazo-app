import { kv } from '@vercel/kv';
import { NextRequest } from 'next/server';
import { addConnection, removeConnection } from '@/lib/settings-broadcast';

async function handleGET(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      console.log('[SSE] New connection established');
      addConnection(controller);
      console.log('[SSE] Connection added to broadcast pool');
      
      // Send initial settings
      kv.get('overlay_settings').then(settings => {
        const data = JSON.stringify(settings || {
          showLocation: true,
          showWeather: true,
          showWeatherIcon: true,
          showWeatherCondition: true,
          weatherIconPosition: 'left',
          showSpeed: true,
          showTime: true,
        });
        console.log('SSE: Sending initial settings:', data);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }).catch(error => {
        console.error('SSE: Failed to load initial settings:', error);
        // Send default settings if KV fails
        const defaultData = JSON.stringify({
          showLocation: true,
          showWeather: true,
          showWeatherIcon: true,
          showWeatherCondition: true,
          weatherIconPosition: 'left',
          showSpeed: true,
          showTime: true,
        });
        controller.enqueue(encoder.encode(`data: ${defaultData}\n\n`));
      });
      
      // Keep connection alive with heartbeat
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"heartbeat"}\n\n`));
        } catch {
          clearInterval(heartbeat);
          removeConnection(controller);
        }
      }, 60000); // 60 second heartbeat - reduced frequency to save costs
      
      // Clean up on close
      request.signal.addEventListener('abort', () => {
        console.log('[SSE] Connection closed, cleaning up');
        clearInterval(heartbeat);
        removeConnection(controller);
        console.log('[SSE] Connection removed from broadcast pool');
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