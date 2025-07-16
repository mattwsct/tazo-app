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
  showWeatherIcon: boolean;
  showWeatherCondition: boolean;
  weatherIconPosition: 'left' | 'right';
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
  
  console.log(`[BROADCAST] Starting broadcast to ${connections.size} connected clients:`, broadcastData);
  
  if (connections.size === 0) {
    console.warn(`[BROADCAST] No active SSE connections! Settings update will be lost unless overlay polls.`);
    return;
  }
  
  let successCount = 0;
  let failureCount = 0;
  
  connections.forEach(controller => {
    try {
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      successCount++;
      console.log(`[BROADCAST] Successfully sent to connection`);
    } catch (error) {
      // Connection closed, remove it
      connections.delete(controller);
      failureCount++;
      console.log(`[BROADCAST] Removed dead SSE connection:`, error);
    }
  });
  
  console.log(`[BROADCAST] Complete: ${successCount} successful, ${failureCount} failed, ${connections.size} remaining active connections`);
} 