// Debug the fallback chain logic
const { formatLocation } = require('./src/utils/overlay-utils.ts');

// Test the New York case
const nyData = { city: "New York City", state: "New York", suburb: "Manhattan" };
console.log('=== NEW YORK DEBUG ===');
console.log('Data:', nyData);

const nyResult = formatLocation(nyData, 'suburb');
console.log('Result:', nyResult);

// Manual trace:
// 1. Primary: suburb = "Manhattan" 
// 2. Context: city = "New York City"
// 3. Are "Manhattan" and "New York City" redundant? No
// 4. So context should be "New York City"

console.log('\nManual check:');
console.log('Primary (suburb):', nyData.suburb);
console.log('Context (city):', nyData.city);
console.log('Are redundant?', nyData.suburb.toLowerCase().includes(nyData.city.toLowerCase()) || nyData.city.toLowerCase().includes(nyData.suburb.toLowerCase()));

// The issue: "Manhattan" and "New York City" are NOT redundant, so it shows "Manhattan, New York City"
// But the user expects "Manhattan, New York" because "New York" is contained in "New York City"

console.log('\n=== TOKYO DEBUG ===');
const tokyoData = { city: "Tokyo", state: "Tokyo Prefecture", suburb: "Shibuya" };
console.log('Data:', tokyoData);

const tokyoResult = formatLocation(tokyoData, 'suburb');
console.log('Result:', tokyoResult);

// Manual trace:
// 1. Primary: suburb = "Shibuya"
// 2. Context: city = "Tokyo" 
// 3. Are "Shibuya" and "Tokyo" redundant? No
// 4. So context should be "Tokyo"

console.log('\nManual check:');
console.log('Primary (suburb):', tokyoData.suburb);
console.log('Context (city):', tokyoData.city);
console.log('Are redundant?', tokyoData.suburb.toLowerCase().includes(tokyoData.city.toLowerCase()) || tokyoData.city.toLowerCase().includes(tokyoData.suburb.toLowerCase()));

// The issue: "Shibuya" and "Tokyo" are NOT redundant, so it shows "Shibuya, Tokyo"
// But the user expects "Shibuya, Tokyo Prefecture" because "Tokyo" is contained in "Tokyo Prefecture"

console.log('\n=== THE REAL ISSUE ===');
console.log('The problem is that we need to check if the context is redundant with the state level,');
console.log('not just if the primary is redundant with the context.');
console.log('In both cases, the city level is redundant with the state level.');
