# Configuration Guide

Complete reference for environment variables and settings.

## Quick Setup

```bash
# Copy example file
cp .env.example .env

# Edit with your settings
nano .env
```

## Environment Variables

### Network Settings

#### CITREA_RPC_URL

- **Type:** String (URL)
- **Default:** `https://rpc.testnet.citrea.xyz`
- **Description:** RPC endpoint for Citrea Testnet

```bash
CITREA_RPC_URL=https://rpc.testnet.citrea.xyz
```

#### CITREA_CHAIN_ID

- **Type:** Number
- **Default:** `5115`
- **Description:** Citrea Testnet chain ID

```bash
CITREA_CHAIN_ID=5115
```

### Contract Settings

#### CONTRACT_ADDRESS

- **Type:** String (Address)
- **Default:** `0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556`
- **Description:** Default contract address to analyze

```bash
CONTRACT_ADDRESS=0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556
```

**Note:** Can be overridden with `--address` CLI parameter

### Database Settings

#### DATABASE_FILE

- **Type:** String (Path)
- **Default:** `citrea_cache.db`
- **Description:** SQLite database file path

```bash
DATABASE_FILE=citrea_cache.db
```

### Performance Settings

#### BATCH_SIZE

- **Type:** Number
- **Default:** `1000`
- **Description:** Number of blocks to scan per batch

```bash
BATCH_SIZE=1000
```

**Recommendations:**

- **100-500:** More stable, slower
- **1000:** Balanced (default)
- **2000-5000:** Faster but may hit RPC limits

#### MAX_RETRIES

- **Type:** Number
- **Default:** `3`
- **Description:** Maximum retry attempts for failed RPC calls

```bash
MAX_RETRIES=3
```

#### RETRY_DELAY_MS

- **Type:** Number (milliseconds)
- **Default:** `1000`
- **Description:** Base delay between retry attempts

```bash
RETRY_DELAY_MS=1000
```

**Note:** Actual delay increases with each retry (1x, 2x, 3x...)

### API Server Settings

#### API_PORT

- **Type:** Number
- **Default:** `3000`
- **Description:** Port for HTTP API server

```bash
API_PORT=3000
```

#### API_HOST

- **Type:** String
- **Default:** `localhost`
- **Description:** Host/IP address for API server

```bash
API_HOST=localhost
```

**Security Note:**

- `localhost` - Local access only (recommended)
- `0.0.0.0` - Accept external connections

## Configuration Examples

### Development (Fast Scanning)

```bash
CITREA_RPC_URL=https://rpc.testnet.citrea.xyz
CITREA_CHAIN_ID=5115
CONTRACT_ADDRESS=0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556
DATABASE_FILE=citrea_cache.db
BATCH_SIZE=2000
MAX_RETRIES=3
RETRY_DELAY_MS=500
API_PORT=3000
API_HOST=localhost
```

### Production (Stable)

```bash
CITREA_RPC_URL=https://rpc.testnet.citrea.xyz
CITREA_CHAIN_ID=5115
CONTRACT_ADDRESS=0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556
DATABASE_FILE=/var/lib/citrea-analytics/citrea_cache.db
BATCH_SIZE=1000
MAX_RETRIES=5
RETRY_DELAY_MS=2000
API_PORT=8080
API_HOST=0.0.0.0
```

### Low-Resource Server

```bash
CITREA_RPC_URL=https://rpc.testnet.citrea.xyz
CITREA_CHAIN_ID=5115
CONTRACT_ADDRESS=0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556
DATABASE_FILE=citrea_cache.db
BATCH_SIZE=500
MAX_RETRIES=3
RETRY_DELAY_MS=3000
API_PORT=3000
API_HOST=localhost
```

### Output & Summaries

#### INCLUDE_EVENTS

- **Type:** Boolean
- **Default:** `false`
- **Description:** Include raw `swapEvents` array in API/JSON output

```bash
INCLUDE_EVENTS=false
```

#### EVENTS_LIMIT

- **Type:** Number
- **Default:** `10`
- **Description:** Max number of raw swap events to include when `INCLUDE_EVENTS=true`

```bash
EVENTS_LIMIT=10
```

#### RECENT_SWAPS_LIMIT

- **Type:** Number
- **Default:** `10`
- **Description:** Number of summarized recent swaps to include (`recentSwaps`)

```bash
RECENT_SWAPS_LIMIT=10
```

## Notes for New Metrics

- No additional environment variables are required for `totalFees_cBTC` or daily fees (`dailyStats.fees_cBTC`).
- Token normalization uses on-chain ERC20 metadata; common tokens (USDC/USDT/WBTC/WETH) apply known decimals heuristics for robustness.
- Raw events are optional via `INCLUDE_EVENTS`/`EVENTS_LIMIT`; summarized `recentSwaps` count is controlled by `RECENT_SWAPS_LIMIT`.

## CLI Parameter Override

CLI parameters take precedence over environment variables:

```bash
# Uses CONTRACT_ADDRESS from .env
pnpm start

# Overrides CONTRACT_ADDRESS from .env
pnpm start -- --address 0xOtherAddress

# Simplified commands
pnpm scan              # Incremental scan
pnpm serve             # API server
pnpm export            # Export to analytics.json

# .env sets defaults, CLI adds options
pnpm start -- --incremental true --serve true
```

**Priority Order:**

1. CLI parameters (highest)
2. Environment variables
3. Hardcoded defaults (lowest)

## Troubleshooting

### Changes Not Taking Effect

**Problem:** `.env` changes ignored

**Solution:** Restart the application

```bash
# Stop (Ctrl+C) and restart
pnpm start
```

### Module Not Found

**Problem:** `Cannot find module 'dotenv'`

**Solution:** Install dependencies

```bash
pnpm install
```

### RPC Connection Errors

**Problem:** Cannot connect to RPC

**Solution:** Verify RPC URL

```bash
curl -X POST $CITREA_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Port Already in Use

**Problem:** API server won't start

**Solution:** Change port or kill existing process

```bash
# Find process on port 3000
lsof -i :3000

# Change port in .env
API_PORT=8080
```

## Security Best Practices

1. **Never commit `.env` to version control**
    - Already in `.gitignore`
    - Contains sensitive configuration

2. **Restrict API access in production**
    - Use `API_HOST=localhost` for local only
    - Use firewall rules if `API_HOST=0.0.0.0`

3. **Use environment-specific files**
    - `.env.development`
    - `.env.production`
    - `.env.test`

## Default Values

| Variable           | Default                                    | Type    |
| ------------------ | ------------------------------------------ | ------- |
| CITREA_RPC_URL     | https://rpc.testnet.citrea.xyz             | String  |
| CITREA_CHAIN_ID    | 5115                                       | Number  |
| CONTRACT_ADDRESS   | 0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556 | Address |
| DATABASE_FILE      | citrea_cache.db                            | String  |
| BATCH_SIZE         | 1000                                       | Number  |
| MAX_RETRIES        | 3                                          | Number  |
| RETRY_DELAY_MS     | 1000                                       | Number  |
| API_PORT           | 3000                                       | Number  |
| API_HOST           | localhost                                  | String  |
| INCLUDE_EVENTS     | false                                      | Boolean |
| EVENTS_LIMIT       | 10                                         | Number  |
| RECENT_SWAPS_LIMIT | 10                                         | Number  |
