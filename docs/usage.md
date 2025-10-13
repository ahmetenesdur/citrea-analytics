# Usage Guide

Complete guide for using Citrea Analytics.

## Quick Reference

```bash
# Full enhanced scan
pnpm start

# Basic version
pnpm start:basic

# Incremental scan
pnpm scan

# Start API server
pnpm serve

# Export to JSON
pnpm export

# All options combined
pnpm start -- --incremental true --serve true --export report.json
```

## CLI Options

| Option          | Type    | Default     | Description                 |
| --------------- | ------- | ----------- | --------------------------- |
| `--address`     | Address | From `.env` | Contract address to scan    |
| `--incremental` | Boolean | `false`     | Resume from last checkpoint |
| `--serve`       | Boolean | `false`     | Start HTTP API server       |
| `--export`      | String  | -           | Export metrics to JSON file |

## Common Workflows

### First-Time Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Run initial scan
pnpm start
```

### Daily Updates

```bash
# Scan only new blocks
pnpm scan
```

### Automated Scanning

```bash
# Add to crontab: daily at midnight
0 0 * * * cd /path/to/citrea-analytics && pnpm scan

# Hourly scan
0 * * * * cd /path/to/citrea-analytics && pnpm scan
```

### Running as Service

```bash
# Install PM2
npm install -g pm2

# Start server
pm2 start "pnpm serve" --name citrea-api

# View logs
pm2 logs citrea-api

# Auto-restart on reboot
pm2 startup
pm2 save
```

### Export Daily Reports

```bash
#!/bin/bash
DATE=$(date +%Y-%m-%d)
pnpm export -- --export "reports/$DATE.json"
```

## Database Management

### Check Database Status

```bash
pnpm db:check
```

### Reset Database

```bash
pnpm db:reset
pnpm start
```

### Manual Queries

```bash
# Connect to database
sqlite3 citrea_cache.db

# Recent transactions
SELECT tx_hash, datetime(timestamp, 'unixepoch') as time, from_address
FROM logs
ORDER BY block_number DESC
LIMIT 10;

# Weekly statistics
SELECT strftime('%Y-W%W', timestamp, 'unixepoch') as week,
       COUNT(*) as transactions,
       COUNT(DISTINCT from_address) as users
FROM logs
GROUP BY week
ORDER BY week DESC;

# Top token pairs
SELECT token_in, token_out, COUNT(*) as swap_count
FROM swap_events
GROUP BY token_in, token_out
ORDER BY swap_count DESC
LIMIT 10;
```

## API Usage

### Get Metrics

```bash
curl http://localhost:3000/metrics | jq
```

### From Node.js

```javascript
import fetch from "node-fetch";

const response = await fetch("http://localhost:3000/metrics");
const metrics = await response.json();

console.log(`Unique Users: ${metrics.uniqueUsers}`);
console.log(`Total Swaps: ${metrics.totalSwaps}`);
```

## Performance Tips

### Optimize Database

```bash
# Analyze and optimize
sqlite3 citrea_cache.db "VACUUM; ANALYZE;"

# Check database size
ls -lh citrea_cache.db
```

### Measure Scan Time

```bash
time pnpm scan
```

### Adjust Batch Size

Edit `.env`:

```bash
# Slower but more stable
BATCH_SIZE=500

# Faster but may hit RPC limits
BATCH_SIZE=2000
```

## Troubleshooting

### Database Issues

```bash
# Reset database
rm citrea_cache.db citrea_cache.db-*
pnpm start
```

### Dependency Issues

```bash
# Reinstall dependencies
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### RPC Connection Issues

```bash
# Test RPC manually
curl -X POST $CITREA_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## Next Steps

- [Database Guide](database.md) - Database structure and management
- [Configuration](configuration.md) - Environment variables
- [Architecture](architecture.md) - System design
