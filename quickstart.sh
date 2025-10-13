#!/bin/bash

# Citrea Analytics - Quick Start Script

echo "🌟 Citrea Analytics - Quick Start Demo"
echo ""

# Check dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install
    echo ""
fi

# Check .env
if [ ! -f ".env" ]; then
    echo "⚙️ Creating .env file..."
    cp .env.example .env
    echo ""
fi

# Step 1: Enhanced scan
echo "📊 Step 1: Running enhanced scan (default)..."
pnpm start -- --address 0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556
echo ""

# Step 2: Incremental scan
echo "🔄 Step 2: Running incremental scan..."
pnpm start -- --incremental true
echo ""

# Step 3: Export (incremental to avoid re-scanning)
echo "💾 Step 3: Exporting metrics..."
pnpm start -- --incremental true --export usage.json
echo "✅ Exported to usage.json"
echo ""

echo "🚀 To start API server: pnpm start -- --serve true"
echo "✅ Demo complete! See docs/ folder for more info."
echo ""
