// Test the refactored location logic
const { formatLocation } = require('./src/utils/overlay-utils.ts');

const testCases = [
  {
    name: "Hoboken, NJ (suburb = city)",
    data: { city: "Hoboken", state: "New Jersey", suburb: "Hoboken" },
    expected: "Hoboken, New Jersey"
  },
  {
    name: "Princeton, NJ (suburb = city)", 
    data: { city: "Princeton", state: "New Jersey", suburb: "Princeton" },
    expected: "Princeton, New Jersey"
  },
  {
    name: "Newark, NJ (different suburb)",
    data: { city: "Newark", state: "New Jersey", suburb: "Ironbound" },
    expected: "Ironbound, Newark"
  },
  {
    name: "New York, NY (city contains state)",
    data: { city: "New York City", state: "New York", suburb: "Manhattan" },
    expected: "Manhattan, New York"
  },
  {
    name: "Tokyo, Japan (city = prefecture)",
    data: { city: "Tokyo", state: "Tokyo Prefecture", suburb: "Shibuya" },
    expected: "Shibuya, Tokyo Prefecture"
  },
  {
    name: "Las Vegas, NV (normal case)",
    data: { city: "Las Vegas", state: "Nevada", suburb: "The Strip" },
    expected: "The Strip, Las Vegas"
  }
];

console.log('=== REFACTORED LOGIC TEST ===');

testCases.forEach(testCase => {
  const result = formatLocation(testCase.data, 'suburb');
  const display = result.context ? `${result.primary}, ${result.context}` : result.primary;
  const passed = display === testCase.expected;
  
  console.log(`\n${testCase.name}:`);
  console.log(`  Expected: ${testCase.expected}`);
  console.log(`  Got:      ${display}`);
  console.log(`  Result:   ${passed ? '✅ PASS' : '❌ FAIL'}`);
});

console.log('\n=== SUMMARY ===');
const results = testCases.map(testCase => {
  const result = formatLocation(testCase.data, 'suburb');
  const display = result.context ? `${result.primary}, ${result.context}` : result.primary;
  return display === testCase.expected;
});

const passed = results.filter(r => r).length;
const total = results.length;
console.log(`Passed: ${passed}/${total} tests`);
