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
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✅ .env file created from template"
    else
        echo "⚠️  No .env.example found, creating minimal .env"
        cat > .env << EOF
# Citrea Testnet Configuration
CITREA_RPC_URL=https://rpc.testnet.citrea.xyz
CITREA_CHAIN_ID=5115
CONTRACT_ADDRESS=0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556
DATABASE_FILE=citrea_cache.db
BATCH_SIZE=1000
MAX_RETRIES=3
API_PORT=3000
API_HOST=localhost
EOF
    fi
    echo ""
fi

# Step 1: Full enhanced scan (first run)
echo "📊 Step 1: Running full enhanced scan..."
pnpm start
echo ""

# Step 2: Incremental scan demonstration
echo "🔄 Step 2: Running incremental scan..."
pnpm scan
echo ""

# Step 3: Export analytics
echo "💾 Step 3: Exporting analytics to JSON..."
pnpm export
echo "✅ Exported to analytics.json"
echo ""

# Step 4: Database check
echo "🗄️  Step 4: Checking database status..."
pnpm db:check
echo ""

echo "🚀 Available commands:"
echo "  pnpm start        - Run enhanced analytics (full scan)"
echo "  pnpm start:basic  - Run basic analytics"
echo "  pnpm scan         - Incremental scan"
echo "  pnpm serve        - Start API server"
echo "  pnpm export       - Export to JSON"
echo "  pnpm db:check     - Check database"
echo "  pnpm db:reset     - Reset database"
echo ""
echo "📖 To start API server: pnpm serve"
echo "🌐 Then visit: http://localhost:3000/metrics"
echo "✅ Demo complete!"
echo ""
