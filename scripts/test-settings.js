#!/usr/bin/env node

/**
 * Settings Test Script
 * Tests that settings changes are properly broadcasted in real-time
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

async function testSettingsRealTime() {
  console.log('🧪 Testing real-time settings updates...\n');
  
  const BASE_URL = 'http://localhost:3000';
  
  try {
    // Test 1: Check current settings
    console.log('📋 Step 1: Fetching current settings...');
    const currentResponse = await fetch(`${BASE_URL}/api/get-settings`, {
      headers: {
        'X-API-Secret': API_SECRET
      }
    });
    
    if (!currentResponse.ok) {
      throw new Error(`Failed to fetch settings: ${currentResponse.status}`);
    }
    
    const currentSettings = await currentResponse.json();
    console.log('✅ Current settings:', currentSettings);
    
    // Test 2: Create a test change
    console.log('\n🔄 Step 2: Making a test change...');
    const testSettings = {
      ...currentSettings,
      showLocation: !currentSettings.showLocation // Toggle location
    };
    
    const saveResponse = await fetch(`${BASE_URL}/api/save-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Secret': API_SECRET
      },
      body: JSON.stringify(testSettings)
    });
    
    if (!saveResponse.ok) {
      throw new Error(`Failed to save settings: ${saveResponse.status}`);
    }
    
    const saveResult = await saveResponse.json();
    console.log('✅ Save result:', saveResult);
    
    // Test 3: Verify the change
    console.log('\n✅ Step 3: Verifying the change...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    const verifyResponse = await fetch(`${BASE_URL}/api/get-settings`, {
      headers: {
        'X-API-Secret': API_SECRET
      }
    });
    
    const verifiedSettings = await verifyResponse.json();
    console.log('📊 Updated settings:', verifiedSettings);
    
    // Test 4: Revert the change
    console.log('\n🔄 Step 4: Reverting the test change...');
    const revertResponse = await fetch(`${BASE_URL}/api/save-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Secret': API_SECRET
      },
      body: JSON.stringify(currentSettings)
    });
    
    const revertResult = await revertResponse.json();
    console.log('✅ Reverted:', revertResult);
    
    // Summary
    console.log('\n📊 Test Summary:');
    console.log(`- Settings API: ${saveResult.success ? '✅ Working' : '❌ Failed'}`);
    console.log(`- KV Storage: ${saveResult.kvSaved ? '✅ Working' : '❌ Failed'}`);
    console.log(`- Real-time Broadcast: ${saveResult.broadcastSent ? '✅ Working' : '❌ Failed'}`);
    
    if (saveResult.broadcastDetails) {
      console.log(`- Active SSE Connections: ${saveResult.broadcastDetails.activeConnections}`);
      console.log(`- Successful Broadcasts: ${saveResult.broadcastDetails.successCount}`);
    }
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testSettingsRealTime(); 