#!/usr/bin/env node

/**
 * Cleanup Script: Remove Malicious Settings
 * This script will clean up the settings by removing unauthorized entries
 */

// Define valid settings keys
const VALID_SETTINGS = {
  showLocation: true,
  showWeather: true,
  showWeatherIcon: true,
  showWeatherCondition: true,
  weatherIconPosition: 'left', // or 'right'
  showSpeed: true,
  showTime: true,
};

async function cleanupSettings() {
  console.log('🧹 Starting settings cleanup...');
  
  try {
    // Load current settings
    const response = await fetch('http://localhost:3000/api/get-settings', {
      headers: {
        'X-API-Secret': process.env.API_SECRET || process.env.NEXT_PUBLIC_API_SECRET
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }
    
    const currentSettings = await response.json();
    console.log('📋 Current settings:', currentSettings);
    
    // Filter out only valid settings
    const cleanSettings = {};
    const removedKeys = [];
    
    for (const [key, value] of Object.entries(currentSettings)) {
      if (key in VALID_SETTINGS) {
        cleanSettings[key] = value;
      } else {
        removedKeys.push(key);
      }
    }
    
    // Add any missing valid settings with defaults
    for (const [key, defaultValue] of Object.entries(VALID_SETTINGS)) {
      if (!(key in cleanSettings)) {
        cleanSettings[key] = defaultValue;
        console.log(`➕ Adding missing setting: ${key} = ${defaultValue}`);
      }
    }
    
    console.log('🗑️  Removing malicious keys:', removedKeys);
    console.log('✅ Clean settings:', cleanSettings);
    
    // Save the cleaned settings
    const saveResponse = await fetch('http://localhost:3000/api/save-settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Secret': process.env.API_SECRET || process.env.NEXT_PUBLIC_API_SECRET
      },
      body: JSON.stringify(cleanSettings)
    });
    
    if (!saveResponse.ok) {
      throw new Error(`Failed to save clean settings: ${saveResponse.status}`);
    }
    
    const result = await saveResponse.json();
    console.log('💾 Settings cleaned and saved successfully!', result);
    console.log(`🔒 Removed ${removedKeys.length} malicious entries:`, removedKeys);
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

// Run the cleanup
cleanupSettings(); 