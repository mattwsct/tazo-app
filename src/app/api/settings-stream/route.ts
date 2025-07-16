import { kv } from '@vercel/kv';
import { NextRequest } from 'next/server';
import { addConnection, removeConnection } from '@/lib/settings-broadcast';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      addConnection(controller);
      
      // Send initial settings
      kv.get('overlay_settings').then(settings => {
        const data = JSON.stringify(settings || {
          showLocation: true,
          showWeather: true,
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
      }, 30000); // 30 second heartbeat
      
      // Clean up on close
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        removeConnection(controller);
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