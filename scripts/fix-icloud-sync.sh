#!/bin/bash

# Fix iCloud sync issues for Node.js projects
# Run this script when experiencing build/run issues

echo "🔧 Fixing iCloud sync issues..."

# Navigate to project root
cd "$(dirname "$0")/.."

echo "📁 Current directory: $(pwd)"

# Remove iCloud sync attributes
echo "🚫 Removing iCloud sync attributes..."
find . -name "*.icloud" -delete 2>/dev/null || true
find . -name "*.icloud-sync-*" -delete 2>/dev/null || true

# Clear build caches
echo "🧹 Clearing build caches..."
rm -rf .next/
rm -rf node_modules/.cache/
rm -rf .npm/
rm -rf .yarn/

# Clear TypeScript build info
echo "🔧 Clearing TypeScript build info..."
rm -f *.tsbuildinfo
rm -f tsconfig.tsbuildinfo

# Reinstall dependencies
echo "📦 Reinstalling dependencies..."
rm -rf node_modules/
rm -f package-lock.json
npm install

# Clear Next.js cache
echo "⚡ Clearing Next.js cache..."
npx next clean

echo "✅ iCloud sync issues fixed!"
echo "💡 Tip: Consider moving your project outside of iCloud Documents folder"
echo "   Recommended location: ~/Projects/ or ~/Development/"
