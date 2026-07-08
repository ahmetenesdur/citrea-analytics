# Usage Guide

Scope is designed to be flexible, supporting interactive prompts for beginners and powerful CLI flags for advanced users.

## Interactive Mode (Recommended)

Simply run:

```bash
pnpm start
```

This will guide you through:

1. Selecting a target network (Citrea/Monad).
2. Choosing between standard polling and real-time indexing.

## CLI Operation Modes

For automated, CI/CD, or headless environments, use direct flags to bypass interactive prompts:

### Scenario 1: Full Historical Backfill & Live Serving (Hybrid Mode)

Captures all historical data matching the contract address, initiates the metrics REST server, and seamlessly connects to the WebSocket stream to capture real-time events.

```bash
pnpm hybrid --network citrea
```

**Expected Output:** A progress bar indicating block synchronization, followed by a persistent `[Metrics]` log indicating the API is actively listening on `http://localhost:3000`.

### Scenario 2: Low-Resource Real-Time Monitoring

Bypasses historical block scanning completely. Directly subscribes to the provider's WebSocket to append strictly new events as they are mined.

```bash
pnpm realtime --network monad
```

### Scenario 3: Snapshot Export

Runs a one-time synchronization pass (no server, no websockets) and flushes the calculated metrics to a file.

```bash
# JSON (default)
pnpm export -- --network citrea

# CSV (generates a directory of files)
pnpm export:csv -- --network citrea

# Markdown report
pnpm export:md -- --network citrea
```

### Scenario 4: API Server with Polling

Starts the REST API server and continuously polls for new blocks at a 10-second interval.

```bash
pnpm serve -- --network citrea
```

## Advanced Options

| Flag              | Description                                                  |
| :---------------- | :----------------------------------------------------------- |
| `--network <id>`  | Skip prompts and use specific network ID (`citrea`/`monad`). |
| `--serve`         | Start the REST API server on port 3000.                      |
| `--incremental`   | Resumes from the last known block in the DB.                 |
| `--address <0x>`  | Override the contract address for the current session.       |
| `--export <path>` | Export metrics to the specified file path.                   |
| `--format <type>` | Set export format: `json`, `csv`, or `md`.                   |

> [!TIP]
> Use `pnpm hybrid` for the most complete experience, as it ensures your database is up-to-date before transitioning to real-time events.

### Verifying State

View statistics, database size, and record counts.

```bash
pnpm db:check
```

### Indexer Error Lifecycle

List open indexer errors for the default Citrea database:

```bash
pnpm errors:list -- --status open --limit 25
```

Use `--network monad` to inspect the Monad database instead:

```bash
pnpm errors:list -- --network monad --status open
```

Mark errors as handled after investigation:

```bash
pnpm errors:resolve -- <error-id>
pnpm errors:ignore -- <error-id>
```

Lifecycle semantics:

- `open`: active error that still needs attention.
- `resolved`: investigated and fixed/cleared.
- `ignored`: accepted/no-action error.

Repeated open errors are coalesced by stage/block/tx/item, incrementing `retry_count` and updating `last_seen_at` instead of creating duplicate rows.

### Development Reset

Clear all locally cached SQLite databases to force a clean historical backfill on the next run.

```bash
pnpm db:reset && pnpm start
```

## API Usage

The API server exposes analytics and operational health endpoints. Start with `pnpm serve` or `pnpm hybrid`.

```bash
# Full aggregated metrics
curl http://localhost:3000/metrics

# Daily time-series with date filter
curl "http://localhost:3000/metrics/daily?from=2026-03-01&to=2026-03-22"

# Token-specific analytics
curl http://localhost:3000/metrics/token/0x8d82c4e3c936c7b5724a382a9c5a4e6eb7ab6d5d

# Trading pair stats
curl http://localhost:3000/metrics/pair/0xe045.../0x8d82...

# Wallet profile
curl http://localhost:3000/metrics/wallet/0xf817...

# System health & sync status
curl http://localhost:3000/health

# Open indexer errors
curl "http://localhost:3000/health/errors?status=open&limit=25"

# Recent scan runs
curl "http://localhost:3000/health/runs?limit=25"
```
