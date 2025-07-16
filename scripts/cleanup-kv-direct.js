#!/usr/bin/env node

/**
 * Direct KV Cleanup Script
 * Cleans malicious entries directly from Vercel KV without needing the dev server
 */

const { createClient } = require('@vercel/kv');

// Load environment variables from .env.local manually
const fs = require('fs');
const path = require('path');

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

// Valid settings
const VALID_SETTINGS = {
  showLocation: true,
  showWeather: true,
  showWeatherIcon: true,
  showWeatherCondition: true,
  weatherIconPosition: 'right', // Keep user's current preference
  showSpeed: true,
  showTime: true,
};

async function cleanupKVSettings() {
  console.log('🧹 Starting direct KV cleanup...');
  
  try {
    // Create KV client
    const kv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    // Get current settings from KV
    const currentSettings = await kv.get('overlay_settings');
    console.log('📋 Current settings from KV:', currentSettings);
    
    if (!currentSettings) {
      console.log('ℹ️  No settings found in KV, creating default settings...');
      await kv.set('overlay_settings', VALID_SETTINGS);
      console.log('✅ Default settings saved to KV');
      return;
    }
    
    // Filter out malicious keys
    const cleanSettings = {};
    const removedKeys = [];
    
    for (const [key, value] of Object.entries(currentSettings)) {
      if (key in VALID_SETTINGS) {
        cleanSettings[key] = value;
      } else {
        removedKeys.push(key);
      }
    }
    
    // Add any missing settings with defaults
    for (const [key, defaultValue] of Object.entries(VALID_SETTINGS)) {
      if (!(key in cleanSettings)) {
        cleanSettings[key] = defaultValue;
        console.log(`➕ Adding missing setting: ${key} = ${defaultValue}`);
      }
    }
    
    console.log('🗑️  Malicious keys found and will be removed:', removedKeys);
    console.log('✅ Clean settings to save:', cleanSettings);
    
    // Save clean settings back to KV
    await kv.set('overlay_settings', cleanSettings);
    
    console.log('💾 Settings cleaned and saved to KV successfully!');
    console.log(`🔒 Removed ${removedKeys.length} malicious entries:`, removedKeys);
    
    // Verify the cleanup
    const verifySettings = await kv.get('overlay_settings');
    console.log('✅ Verification - settings in KV now:', verifySettings);
    
  } catch (error) {
    console.error('❌ KV cleanup failed:', error);
    console.error('Make sure you have KV_REST_API_URL and KV_REST_API_TOKEN in your .env.local');
    process.exit(1);
  }
}

// Run the cleanup
cleanupKVSettings(); 