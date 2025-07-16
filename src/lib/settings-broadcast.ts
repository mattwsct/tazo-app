// Store active connections
const connections = new Set<ReadableStreamDefaultController>();

export function addConnection(controller: ReadableStreamDefaultController) {
  connections.add(controller);
}

export function removeConnection(controller: ReadableStreamDefaultController) {
  connections.delete(controller);
}

interface OverlaySettings {
  showLocation: boolean;
  showWeather: boolean;
  showSpeed: boolean;
  showTime: boolean;
}

// Function to broadcast settings to all connected clients
export async function broadcastSettings(settings: OverlaySettings) {
  const encoder = new TextEncoder();
  const data = JSON.stringify(settings);
  
  connections.forEach(controller => {
    try {
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
    } catch {
      // Connection closed, remove it
      connections.delete(controller);
    }
  });
} 