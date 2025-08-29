// Test script to check LocationIQ rate limit status
// Run this in your browser console on the overlay page to see current usage

console.log('=== LocationIQ Rate Limit Check ===');

// Check if the rate limiting functions are available
if (typeof window !== 'undefined') {
  // Try to access the rate limiting functions from the overlay
  console.log('Checking for rate limiting functions...');
  
  // You can run this in the browser console on your overlay page
  console.log(`
To check your current LocationIQ usage, run this in the browser console:

// Check remaining daily calls
console.log('Remaining daily calls:', window.locationiq?.remaining || 'Not available');

// Check if you're hitting rate limits
console.log('Rate limit status:', window.locationiq?.rateLimitStatus || 'Not available');

// Check the last API call time
console.log('Last API call:', window.locationiq?.lastCall || 'Not available');
  `);
} else {
  console.log('This script should be run in a browser environment');
}

// Alternative: Check the network tab in DevTools
console.log(`
=== Manual Check Instructions ===

1. Open your overlay page in the browser
2. Open DevTools (F12)
3. Go to Network tab
4. Look for requests to 'us1.locationiq.com'
5. Check the response status codes:
   - 200: Success
   - 429: Rate limit exceeded (too many requests)
   - 402: Payment required (daily limit exceeded)

If you see 429 errors, you're hitting the per-second rate limit.
If you see 402 errors, you've hit the daily limit of 1000 calls.
`);

// Check current time and when limits reset
const now = new Date();
const midnight = new Date(now);
midnight.setHours(24, 0, 0, 0);

console.log(`
=== Time Information ===
Current time: ${now.toISOString()}
Daily limit resets at: ${midnight.toISOString()}
Time until reset: ${Math.round((midnight - now) / 1000 / 60)} minutes
`);

console.log('=== End of Rate Limit Check ===');

