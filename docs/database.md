# Database Management

Guide to understanding and managing the SQLite database.

## Database Structure

### Tables

#### `meta` - Checkpoint Storage

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Stores scanning progress:

| Key              | Value    |
| ---------------- | -------- |
| lastScannedBlock | 16769945 |

#### `logs` - Transaction Records

```sql
CREATE TABLE logs (
  tx_hash TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL,
  from_address TEXT NOT NULL,
  gas_used TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
```

Indexes: `block_number`, `from_address`, `timestamp`

#### `swap_events` - Swap Event Details

```sql
CREATE TABLE swap_events (
  tx_hash TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL,
  sender TEXT NOT NULL,
  amount_in TEXT NOT NULL,
  amount_out TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  destination TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
);
```

Indexes: `token_in, token_out`, `sender`

## How Incremental Scanning Works

### First Run

```bash
pnpm start
```

1. Creates database and tables
2. Scans from block 0 to latest
3. Saves `lastScannedBlock` in `meta` table

### Subsequent Runs

```bash
pnpm scan
```

1. Reads `lastScannedBlock` from database
2. Scans only new blocks
3. Updates `lastScannedBlock`

### Example

**First run:**

```
✓ Database initialized
🔍 Scanning blocks 0 → 16,769,945
✅ Scan complete! 1,234 transactions | 567 swaps
```

**Second run (3 days later):**

```
📊 Resuming from block 16,769,946
🔍 Scanning blocks 16,769,946 → 16,850,000
✅ Scan complete! 89 NEW transactions | 23 NEW swaps
```

**Third run (same day):**

```
📊 Resuming from block 16,850,001
✓ Already up to date!
```

## Database Commands

### Check Status

```bash
pnpm db:check
```

Output:

```
🗄️  Database Status Check

📊 Meta Information:
  Last Scanned Block: 16,850,000

📈 Statistics:
  Total Transactions: 1,323
  Total Swap Events: 590
  Unique Users: 234

🔗 Block Range:
  First Block: 1,234,567
  Last Block: 16,850,000

💾 Database File:
  File: citrea_cache.db
  Size: 2.73 MB
```

### Reset Database

```bash
pnpm db:reset
```

⚠️ **Warning:** This deletes all data!

## Common Queries

### Top Users

```sql
SELECT from_address, COUNT(*) as tx_count
FROM logs
GROUP BY from_address
ORDER BY tx_count DESC
LIMIT 10;
```

### Daily Statistics

```sql
SELECT date(timestamp, 'unixepoch') as day,
       COUNT(*) as tx_count,
       COUNT(DISTINCT from_address) as unique_users
FROM logs
GROUP BY day
ORDER BY day DESC
LIMIT 30;
```

### Top Token Pairs

```sql
SELECT token_in, token_out, COUNT(*) as swap_count
FROM swap_events
GROUP BY token_in, token_out
ORDER BY swap_count DESC
LIMIT 10;
```

### Recent Swaps (24h)

```sql
SELECT *
FROM swap_events
WHERE timestamp > strftime('%s', 'now') - 86400
ORDER BY timestamp DESC;
```

### User Activity

```sql
SELECT l.*, s.*
FROM logs l
LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
WHERE l.from_address = '0x...'
ORDER BY l.block_number DESC;
```

## Troubleshooting

### Database Locked

**Problem:** Another process is using the database

**Solution:**

```bash
pkill -f "tsx analyze"
pnpm start
```

### Database Corrupted

**Problem:** Process interrupted or disk full

**Solution:**

```bash
pnpm run db:reset
pnpm start
```

### Table Not Found

**Problem:** Database file exists but tables missing

**Solution:**

```bash
rm citrea_cache.db
pnpm start
```

### Slow Scanning

**Problem:** RPC rate limits or network issues

**Solution:**

Edit `.env`:

```bash
BATCH_SIZE=500
MAX_RETRIES=5
RETRY_DELAY_MS=2000
```

### Database Too Large

**Problem:** Database exceeds 100MB

**Solution 1 - Optimize:**

```bash
sqlite3 citrea_cache.db "VACUUM;"
```

**Solution 2 - Clean old data:**

```sql
-- Delete data older than 30 days
DELETE FROM swap_events
WHERE timestamp < strftime('%s', 'now') - (86400 * 30);

DELETE FROM logs
WHERE timestamp < strftime('%s', 'now') - (86400 * 30);

-- Optimize
VACUUM;
```

## Best Practices

### Regular Backups

```bash
# Daily backup
cp citrea_cache.db "backups/citrea_cache_$(date +%Y%m%d).db"

# Or use SQLite backup
sqlite3 citrea_cache.db ".backup backups/citrea_cache_$(date +%Y%m%d_%H%M%S).db"
```

### Automated Scanning

```bash
# Cron: Every 6 hours
0 */6 * * * cd /path/to/citrea-analytics && pnpm scan

# Cron: Daily at midnight
0 0 * * * cd /path/to/citrea-analytics && pnpm scan
```

### Log Rotation

```bash
# Save logs to file
pnpm start >> logs/scan_$(date +%Y%m%d).log 2>&1

# Clean old logs (30+ days)
find logs/ -name "scan_*.log" -mtime +30 -delete
```

### Monitor Database

```bash
# Watch database size
watch -n 60 'ls -lh citrea_cache.db'

# Monitor via API
pnpm serve &
curl http://localhost:3000/metrics | jq
```

## Summary

**How It Works:**

1. First run → Scan from block 0, save checkpoint
2. Incremental run → Resume from checkpoint, scan only new blocks
3. Already current → Skip scanning

**Key Points:**

- Data is never deleted, only appended
- `lastScannedBlock` updated after each scan
- WAL mode allows multiple readers
- Indexes enable fast queries

**Commands:**

- `pnpm start` → Full enhanced scan
- `pnpm scan` → Incremental scan
- `pnpm db:check` → Check status
- `pnpm db:reset` → Reset database
