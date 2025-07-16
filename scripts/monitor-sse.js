#!/usr/bin/env node

/**
 * SSE Monitor Script
 * Monitors Server-Sent Events connection to debug real-time issues
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local manually
try {
  const envPath = path.join(__dirname, '..', '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
} catch (error) {
  console.warn('Could not load .env.local file:', error.message);
}

const API_SECRET = process.env.API_SECRET || process.env.NEXT_PUBLIC_API_SECRET;

if (!API_SECRET) {
  console.error('❌ API_SECRET not found in environment variables');
  process.exit(1);
}

// Simple EventSource polyfill for Node.js
class EventSource {
  constructor(url) {
    this.url = url;
    this.readyState = EventSource.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.connect();
  }
  
  connect() {
    const https = require('https');
    const http = require('http');
    const urlObj = new URL(this.url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      }
    };
    
    const req = client.request(options, (res) => {
      if (res.statusCode === 200) {
        this.readyState = EventSource.OPEN;
        if (this.onopen) this.onopen();
        
        res.on('data', (chunk) => {
          const data = chunk.toString();
          const lines = data.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const eventData = line.substring(6);
              if (this.onmessage) {
                this.onmessage({ data: eventData });
              }
            }
          }
        });
        
        res.on('end', () => {
          this.readyState = EventSource.CLOSED;
          console.log('🔌 SSE connection ended');
        });
        
      } else {
        this.readyState = EventSource.CLOSED;
        if (this.onerror) this.onerror(new Error(`HTTP ${res.statusCode}`));
      }
    });
    
    req.on('error', (error) => {
      this.readyState = EventSource.CLOSED;
      if (this.onerror) this.onerror(error);
    });
    
    req.end();
  }
  
  close() {
    this.readyState = EventSource.CLOSED;
  }
}

EventSource.CONNECTING = 0;
EventSource.OPEN = 1;
EventSource.CLOSED = 2;

function monitorSSE() {
  console.log('📡 Starting SSE monitoring...\n');
  
  const url = `http://localhost:3000/api/settings-stream?secret=${encodeURIComponent(API_SECRET)}`;
  console.log('🔗 Connecting to:', url.replace(API_SECRET, '***SECRET***'));
  
  const eventSource = new EventSource(url);
  let messageCount = 0;
  let heartbeatCount = 0;
  let settingsUpdateCount = 0;
  let lastHeartbeat = Date.now();
  
  eventSource.onopen = () => {
    console.log('✅ SSE connection established');
    console.log('📊 Monitoring events... (Press Ctrl+C to stop)\n');
  };
  
  eventSource.onmessage = (event) => {
    messageCount++;
    const timestamp = new Date().toLocaleTimeString();
    
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'heartbeat') {
        heartbeatCount++;
        lastHeartbeat = Date.now();
        console.log(`💓 [${timestamp}] Heartbeat #${heartbeatCount}`);
      } else if (data.type === 'settings_update') {
        settingsUpdateCount++;
        const latency = Date.now() - data.timestamp;
        console.log(`⚙️  [${timestamp}] Settings Update #${settingsUpdateCount} (${latency}ms latency)`);
        console.log('   📋 Settings:', JSON.stringify(data, null, 2).replace(/^/gm, '      '));
      } else {
        // Legacy format or unknown
        console.log(`📦 [${timestamp}] Message #${messageCount}:`);
        console.log('   📋 Data:', JSON.stringify(data, null, 2).replace(/^/gm, '      '));
      }
    } catch (error) {
      console.log(`❌ [${timestamp}] Invalid JSON in message #${messageCount}:`, event.data);
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('❌ SSE connection error:', error.message);
  };
  
  // Monitor heartbeat timing
  const heartbeatMonitor = setInterval(() => {
    const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
    if (timeSinceLastHeartbeat > 45000) { // 45 seconds (expecting 30s intervals)
      console.warn(`⚠️  No heartbeat for ${Math.round(timeSinceLastHeartbeat / 1000)}s - connection may be dead`);
    }
  }, 10000);
  
  // Print stats every 30 seconds
  const statsInterval = setInterval(() => {
    console.log(`\n📊 Connection Stats:`);
    console.log(`   💓 Heartbeats: ${heartbeatCount}`);
    console.log(`   ⚙️  Settings Updates: ${settingsUpdateCount}`);
    console.log(`   📦 Total Messages: ${messageCount}`);
    console.log(`   🕒 Last Heartbeat: ${Math.round((Date.now() - lastHeartbeat) / 1000)}s ago\n`);
  }, 30000);
  
  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping SSE monitor...');
    clearInterval(heartbeatMonitor);
    clearInterval(statsInterval);
    eventSource.close();
    
    console.log('\n📊 Final Stats:');
    console.log(`   💓 Total Heartbeats: ${heartbeatCount}`);
    console.log(`   ⚙️  Total Settings Updates: ${settingsUpdateCount}`);
    console.log(`   📦 Total Messages: ${messageCount}`);
    console.log('\n👋 Goodbye!');
    process.exit(0);
  });
}

// Run the monitor
monitorSSE(); 