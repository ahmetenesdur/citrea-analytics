# Database Schema

The project utilizes SQLite configured in Write-Ahead Logging (`WAL`) mode. This architectural choice natively enables highly concurrent read/write operations by allowing reads to proceed while a distinct write transaction happens concurrently. A separate, isolated database file is created per network (e.g., `citrea_cache.db`), mapping to a highly parallelized operating architecture.

## Entity Relationship Overview

At the core, the `logs` table operates as the foundational anchor. As transactions are ingested, any discovered standard router swap events are parsed and stored in `swap_events`, holding a foreign key reference (`tx_hash`) back to the originating log. `fees` are mapped similarly 1:1 against the `logs` table using the `tx_hash`.

## Core Tables

### `logs`

Raw transaction logs.

- `tx_hash` (TEXT, PK): Cryptographic transaction hash.
- `block_number` (INTEGER): Index of the block where the event occurred.
- `timestamp` (INTEGER): Unix block timestamp.
- `from_address` (TEXT): Sender wallet address.

### `swap_events`

Parsed Swap events. Supports multiple swaps per transaction.

- `id` (INTEGER, PK): Auto-incrementing relational ID.
- `tx_hash` (TEXT, FK): Cryptographic link to parent `logs` entry.
- `sender` (TEXT): Cryptographic address of the user initiating the swap workflow.
- `token_in` / `token_out` (TEXT): Respective token contract addresses.
- `amount_in` / `amount_out` (TEXT): Raw token amounts (stored as strings to prevent integer overflow beyond MAX_SAFE_INTEGER).
- `amount_out_min` (TEXT): User's minimum received limit parsed from router calldata.
- `execution_quality` (REAL): Derived safety margin percentage calculating slippage dynamics.

### `fees`

Transaction fee data.

- `tx_hash` (TEXT, PK): Cryptographic link to parent `logs` entry.
- `fee_wei` (TEXT): Total topological fee calculated via (Gas Used \* Effective Gas Price).

### `token_prices`

Cached USD values for tokens.

- `address` (TEXT, PK): The distinct token contract address.
- `price_usd` (REAL): The latest spot price denominated in USD derived via the oracle.
- `last_updated` (INTEGER): Unix timestamp denoting the freshness of the fetched payload.

### `token_metadata`

Metadata about tokens discovered during indexing.

- `address` (TEXT, PK): Token contract address.
- `decimals` (INTEGER): Defined scale mapping token magnitude.
- `symbol` (TEXT): Human-readable ticker symbol.
- `coingecko_id` (TEXT): Optional platform-specific CoinGecko REST scalar identifier.

## Observability Tables

### `scan_runs`

Historical and incremental scan execution records.

- `id` (INTEGER, PK): Scan run identifier.
- `network` (TEXT): Network id, e.g. `citrea` or `monad`.
- `mode` (TEXT): Scan mode, such as `full` or `incremental`.
- `start_block` / `end_block` (INTEGER): Requested block range.
- `status` (TEXT): `running`, `completed`, or `failed`.
- `processed_logs` / `processed_swaps` (INTEGER): Run counters.
- `error_count` (INTEGER): Number of associated indexer errors.
- `error_message` (TEXT): Failure summary for failed runs.

### `indexer_errors`

Failure records for scan and backfill stages.

- `run_id` (INTEGER, nullable FK): Related `scan_runs.id` when available.
- `network` (TEXT): Network id.
- `stage` (TEXT): Pipeline stage, e.g. `scan_range`, `fee_backfill`, `swap_event_backfill`, `token_metadata_backfill`.
- `block_start` / `block_end` / `block_number` (INTEGER): Optional range or block context.
- `tx_hash` (TEXT): Optional transaction hash context.
- `item` (TEXT): Serialized fallback context when no transaction hash applies.
- `error_message` / `error_stack` (TEXT): Captured error details.
- `status` (TEXT): Lifecycle state: `open`, `resolved`, or `ignored`.
- `retry_count` (INTEGER): Number of repeated sightings coalesced into the open error row.
- `created_at` / `last_seen_at` (INTEGER): Unix timestamps for first and latest sightings.

## Useful SQL Queries

**Top 5 Token Pairs by Volume**

```sql
SELECT token_in, token_out, COUNT(*) as count
FROM swap_events
GROUP BY token_in, token_out
ORDER BY count DESC
LIMIT 5;
```

**Daily Transaction Count**

```sql
SELECT date(timestamp, 'unixepoch') as day, COUNT(*)
FROM logs
GROUP BY day
ORDER BY day DESC;
```

**Wallet Activity Summary**

```sql
SELECT sender, COUNT(*) as swaps,
       COUNT(DISTINCT token_in || token_out) as pairs
FROM swap_events
GROUP BY sender
ORDER BY swaps DESC
LIMIT 10;
```

## Database Maintenance

```bash
# Check database size and stats
pnpm db:check

# Delete all data for all networks
pnpm db:reset

# List active indexer errors
pnpm errors:list -- --status open

# Mark an error as resolved or ignored
pnpm errors:resolve -- <error-id>
pnpm errors:ignore -- <error-id>
```
