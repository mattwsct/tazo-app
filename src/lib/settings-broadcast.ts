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
  const broadcastData = {
    ...settings,
    timestamp: Date.now(),
    type: 'settings_update'
  };
  const data = JSON.stringify(broadcastData);
  
  console.log(`Broadcasting to ${connections.size} connected clients:`, broadcastData);
  
  let successCount = 0;
  let failureCount = 0;
  
  connections.forEach(controller => {
    try {
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      successCount++;
    } catch {
      // Connection closed, remove it
      connections.delete(controller);
      failureCount++;
      console.log('Removed dead SSE connection');
    }
  });
  
  console.log(`Broadcast complete: ${successCount} successful, ${failureCount} failed, ${connections.size} active connections`);
} 