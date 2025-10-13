# Citrea Analytics

Analyze smart contract activity on Citrea Testnet with SQLite caching and incremental scanning.

## Features

- **Incremental Scanning** - Only scans new blocks since last run
- **SQLite Cache** - Persistent storage with WAL mode
- **Event Decoding** - Decode and analyze Swap events
- **Auto Retry** - Automatic retry for RPC failures
- **HTTP API** - RESTful metrics endpoint
- **JSON Export** - Export analytics to file
- **TypeScript** - Full type safety with ESM

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env

# Run scanner
pnpm start
```

## Configuration

Edit the `.env` file:

```bash
# Citrea Testnet
CITREA_RPC_URL=https://rpc.testnet.citrea.xyz
CITREA_CHAIN_ID=5115

# Contract to analyze
CONTRACT_ADDRESS=0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556

# Database
DATABASE_FILE=citrea_cache.db

# Performance
BATCH_SIZE=1000
MAX_RETRIES=3

# API Server
API_PORT=3000
API_HOST=localhost
```

See [docs/configuration.md](docs/configuration.md) for all options.

## Usage

### Full Enhanced Scan

```bash
pnpm start
```

### Basic Version

```bash
pnpm start:basic
```

### Incremental Scan

```bash
pnpm scan
```

### Start API Server

```bash
pnpm serve
```

Access at: `http://localhost:3000/metrics`

### Export to JSON

```bash
pnpm export
```

### Combined Options

```bash
pnpm start -- --incremental true --serve true --export report.json
```

## API Response

```json
{
  "uniqueUsers": 29326,
  "uniqueTxCount": 137368,
  "totalGas_cBTC": "0.0000",
  "totalSwaps": 137365,
  "volumeByToken": {
    "inbound": [
      {"token": "0x8d0c...", "normalizedAmount": "232.43", "swapCount": 47920}
    ],
    "outbound": [...]
  },
  "topCallers": [{"addr": "0xabc...", "count": 3047}],
  "topTokenPairs": [
    {
      "tokenIn": "0x8d0c...",
      "tokenOut": "0x36c1...",
      "swapCount": 41212,
      "volumeIn": "181.74 (0x8d0c...)",
      "volumeOut": "0.000046 (0x36c1...)"
    }
  ],
  "dailyStats": [{"day": "2025-10-13", "tx": 577, "uniqueUsers": 360, "swaps": 577}],
  "swapEvents": [{"sender": "0x...", "amount_in": "100...", "token_in": "0x...", ...}]
}
```

---

## Project Structure

```
citrea-analytics/
├── analyze.ts              # Standard version
├── analyze-enhanced.ts     # Enhanced version (default)
├── abi.ts                  # Contract ABI
├── check-db.ts             # Database checker
├── docs/                   # Documentation
├── package.json            # Dependencies
└── .env                    # Configuration
```

## Documentation

- [Usage Guide](docs/usage.md) - CLI options and examples
- [Database Guide](docs/database.md) - Database structure and management
- [Configuration](docs/configuration.md) - Environment variables

## Tech Stack

- Node.js 18+
- TypeScript 5.9+ (ESM)
- SQLite with WAL mode
- Viem (Ethereum client)
- pnpm

---

[![GitHub](https://img.shields.io/badge/GitHub-ahmetenesdur-blue?logo=github)](https://github.com/ahmetenesdur)
