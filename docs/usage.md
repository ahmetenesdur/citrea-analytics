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

| Option            | Type    | Default     | Description                 |
| ----------------- | ------- | ----------- | --------------------------- |
| `--address`       | Address | From `.env` | Contract address to scan    |
| `--incremental`   | Boolean | `false`     | Resume from last checkpoint |
| `--serve`         | Boolean | `false`     | Start HTTP API server       |
| `--export`        | String  | -           | Export metrics to JSON file |
| `--includeEvents` | Boolean | `false`     | Include raw `swapEvents`    |
| `--eventsLimit`   | Number  | `10`        | Limit for raw events        |
| `--recentLimit`   | Number  | `10`        | Limit for `recentSwaps`     |

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
# Export to dated file (override default analytics.json)
pnpm start -- --incremental true --export "reports/$DATE.json"
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

## Event-Level vs Tx-Level Counts

By default, some summaries count swaps at the transaction level (distinct tx). With multi-swap support, you may prefer event-level counts.

### Daily swaps (tx-level)

```sql
SELECT
  strftime('%Y-%m-%d', l.timestamp, 'unixepoch') AS day,
  COUNT(DISTINCT s.tx_hash) AS swaps
FROM logs l
LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
GROUP BY day
ORDER BY day DESC
LIMIT 30;
```

### Daily swaps (event-level)

```sql
SELECT
  strftime('%Y-%m-%d', s.timestamp, 'unixepoch') AS day,
  COUNT(*) AS swaps
FROM swap_events s
GROUP BY day
ORDER BY day DESC
LIMIT 30;
```

### Recent swaps ordering (with multi-swap)

```sql
SELECT tx_hash, timestamp, sender, amount_in, amount_out, token_in, token_out
FROM swap_events
ORDER BY block_number DESC, log_index DESC
LIMIT 20;
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
console.log(`Total Fees: ${metrics.totalFees_cBTC} cBTC`);
console.log(
	`Latest Day Fees: ${metrics.dailyStats?.[0]?.day} ${metrics.dailyStats?.[0]?.fees_cBTC} cBTC`
);
console.log(`Daily swaps (tx-level): ${metrics.dailyStats?.[0]?.swapsTx}`);
console.log(`Daily swaps (event-level): ${metrics.dailyStats?.[0]?.swapsEvent}`);
console.log(
	`Recent Swap #1: ${metrics.recentSwaps?.[0]?.amountIn} → ${metrics.recentSwaps?.[0]?.amountOut}`
);

// Additional fields:
// - metrics.volumeByToken.inbound/outbound: normalized using token decimals & symbols
// - metrics.topTokenPairs: volumes normalized per token pair
// - metrics.dailyStats[].fees_cBTC: daily aggregated fees in cBTC
// - metrics.dailyStats[].swapsTx: tx-level swaps per day (distinct transactions)
// - metrics.dailyStats[].swapsEvent: event-level swaps per day (total swap events)
// - metrics.range: { firstBlock, lastBlock, lastUpdatedAt }
// - metrics.recentSwaps: last N swaps (normalized)
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
