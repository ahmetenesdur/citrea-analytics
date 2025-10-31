#!/usr/bin/env tsx

import "dotenv/config";
import { createPublicClient, http, type Address, type Log } from "viem";
import { defineChain } from "viem/utils";
import Database from "better-sqlite3";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

// Configuration & Types

// Load environment variables
const CITREA_RPC_URL = process.env.CITREA_RPC_URL || "https://rpc.testnet.citrea.xyz";
const CITREA_CHAIN_ID = parseInt(process.env.CITREA_CHAIN_ID || "5115", 10);
const DEFAULT_CONTRACT = (process.env.CONTRACT_ADDRESS ||
	"0x72B1fC6b54733250F4e18dA4A20Bb2DCbC598556") as Address;
const DB_FILE = process.env.DATABASE_FILE || "citrea_cache.db";
const BATCH_SIZE = BigInt(process.env.BATCH_SIZE || "1000");
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || "1000", 10);
const API_PORT = parseInt(process.env.API_PORT || "3000", 10);
const API_HOST = process.env.API_HOST || "localhost";

const CITREA_TESTNET = defineChain({
	id: CITREA_CHAIN_ID,
	name: "Citrea Testnet",
	nativeCurrency: { name: "cBTC", symbol: "cBTC", decimals: 18 },
	rpcUrls: {
		default: { http: [CITREA_RPC_URL] },
	},
	blockExplorers: {
		default: { name: "Explorer", url: "https://explorer.testnet.citrea.xyz" },
	},
});

interface CLIArgs {
	address: Address;
	incremental: boolean;
	serve: boolean;
	export?: string;
}

interface LogRow {
	tx_hash: string;
	block_number: number;
	from_address: string;
	gas_used: string;
	timestamp: number;
}

interface Metrics {
	uniqueUsers: number;
	uniqueTxCount: number;
	totalGas_cBTC: string;
	topCallers: Array<{ addr: string; count: number }>;
	dailyStats: Array<{ day: string; tx: number; uniqueUsers: number }>;
}

// Database Setup

/**
 * Initialize SQLite database with schema and WAL mode
 */
function initDatabase(): Database.Database {
	const db = new Database(DB_FILE);

	// Enable WAL mode for better concurrency
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("cache_size = -64000"); // 64MB cache

	// Create tables if not exist
	db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      tx_hash TEXT PRIMARY KEY,
      block_number INTEGER NOT NULL,
      from_address TEXT NOT NULL,
      gas_used TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_block_number ON logs(block_number);
    CREATE INDEX IF NOT EXISTS idx_from_address ON logs(from_address);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON logs(timestamp);
    
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

	console.log("✓ Database initialized with WAL mode");
	return db;
}

/**
 * Get or set metadata value
 */
function getMeta(db: Database.Database, key: string): string | null {
	const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

function setMeta(db: Database.Database, key: string, value: string): void {
	db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

// RPC Client & Blockchain Interaction

/**
 * Create Viem public client for Citrea Testnet
 */
function createCitreaClient() {
	return createPublicClient({
		chain: CITREA_TESTNET,
		transport: http(CITREA_RPC_URL, {
			retryCount: MAX_RETRIES,
			retryDelay: RETRY_DELAY_MS,
		}),
	});
}

/**
 * Fetch logs with retry mechanism
 */
async function fetchLogsWithRetry(
	client: ReturnType<typeof createCitreaClient>,
	address: Address,
	fromBlock: bigint,
	toBlock: bigint,
	retries = MAX_RETRIES
): Promise<Log[]> {
	try {
		return await client.getLogs({
			address,
			fromBlock,
			toBlock,
		});
	} catch (error) {
		if (retries > 0) {
			console.warn(`⚠ RPC error, retrying... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
			await new Promise((resolve) =>
				setTimeout(resolve, RETRY_DELAY_MS * (MAX_RETRIES - retries + 1))
			);
			return fetchLogsWithRetry(client, address, fromBlock, toBlock, retries - 1);
		}
		throw error;
	}
}

// Incremental Scanning

/**
 * Scan contract logs incrementally and store in database
 */
export async function scanLogs(
	db: Database.Database,
	client: ReturnType<typeof createCitreaClient>,
	address: Address,
	incremental: boolean
): Promise<void> {
	const latestBlock = await client.getBlockNumber();
	let startBlock = 0n;

	if (incremental) {
		const lastScanned = getMeta(db, "lastScannedBlock");
		if (lastScanned) {
			startBlock = BigInt(lastScanned) + 1n;
			console.log(`📊 Resuming from block ${startBlock.toLocaleString()}`);
		}
	} else {
		console.log("🔄 Full scan mode - scanning from genesis");
	}

	if (startBlock > latestBlock) {
		console.log("✓ Already up to date!");
		return;
	}

	console.log(
		`🔍 Scanning blocks ${startBlock.toLocaleString()} → ${latestBlock.toLocaleString()}`
	);

	const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO logs (tx_hash, block_number, from_address, gas_used, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

	let currentBlock = startBlock;
	let totalLogs = 0;

	while (currentBlock <= latestBlock) {
		const endBlock =
			currentBlock + BATCH_SIZE > latestBlock ? latestBlock : currentBlock + BATCH_SIZE - 1n;

		try {
			const logs = await fetchLogsWithRetry(client, address, currentBlock, endBlock);

			if (logs.length > 0) {
				const logData = await Promise.all(
					logs.map(async (log) => {
						try {
							const [receipt, block] = await Promise.all([
								client.getTransactionReceipt({ hash: log.transactionHash! }),
								client.getBlock({ blockNumber: log.blockNumber! }),
							]);
							return {
								tx_hash: log.transactionHash!,
								block_number: Number(log.blockNumber!),
								from_address: receipt.from.toLowerCase(),
								gas_used: receipt.gasUsed.toString(),
								timestamp: Number(block.timestamp),
							};
						} catch (e) {
							console.warn(
								`⚠ Could not process log for ${log.transactionHash!}:`,
								(e as Error).message
							);
							return null;
						}
					})
				);

				const validLogData = logData.filter((d) => d !== null) as LogRow[];

				if (validLogData.length > 0) {
					const insertMany = db.transaction((logs: LogRow[]) => {
						for (const log of logs) {
							insertStmt.run(
								log.tx_hash,
								log.block_number,
								log.from_address,
								log.gas_used,
								log.timestamp
							);
						}
					});

					insertMany(validLogData);
					totalLogs += validLogData.length;
				}
			}

			// Update progress
			const denom = latestBlock - startBlock;
			const progress = denom === 0n ? 100 : Number(((endBlock - startBlock) * 100n) / denom);
			console.log(
				`  Block ${endBlock.toLocaleString()} | ${logs.length} logs | ${progress.toFixed(1)}% complete`
			);

			currentBlock = endBlock + 1n;
		} catch (error) {
			console.error(`❌ Error scanning blocks ${currentBlock}-${endBlock}:`, error);
			throw error;
		}
	}

	// Update last scanned block
	setMeta(db, "lastScannedBlock", latestBlock.toString());
	console.log(`\n✓ Scan complete! Indexed ${totalLogs} new transactions`);
}

// Analytics & Metrics

/**
 * Calculate analytics from database
 */
function calculateMetrics(db: Database.Database): Metrics {
	// Unique users
	const uniqueUsers = db
		.prepare("SELECT COUNT(DISTINCT from_address) as count FROM logs")
		.get() as { count: number };

	// Unique transactions
	const uniqueTxCount = db.prepare("SELECT COUNT(*) as count FROM logs").get() as {
		count: number;
	};

	// Total gas (convert from wei to cBTC)
	const totalGasRow = db
		.prepare("SELECT SUM(CAST(gas_used AS REAL)) as total FROM logs")
		.get() as { total: number };
	const totalGas_cBTC = (totalGasRow.total / 1e18).toFixed(4);

	// Top callers
	const topCallers = db
		.prepare(
			`
    SELECT from_address as addr, COUNT(*) as count
    FROM logs
    GROUP BY from_address
    ORDER BY count DESC
    LIMIT 10
  `
		)
		.all() as Array<{ addr: string; count: number }>;

	// Daily statistics
	const dailyStats = db
		.prepare(
			`
    SELECT 
      strftime('%Y-%m-%d', timestamp, 'unixepoch') as day,
      COUNT(*) as tx,
      COUNT(DISTINCT from_address) as uniqueUsers
    FROM logs
    GROUP BY day
    ORDER BY day DESC
  `
		)
		.all() as Array<{ day: string; tx: number; uniqueUsers: number }>;

	return {
		uniqueUsers: uniqueUsers.count,
		uniqueTxCount: uniqueTxCount.count,
		totalGas_cBTC,
		topCallers,
		dailyStats,
	};
}

// HTTP API Server

/**
 * Start HTTP server with /metrics endpoint
 */
function startServer(db: Database.Database, port = API_PORT): void {
	const server = createServer((req, res) => {
		if (req.url === "/metrics" && req.method === "GET") {
			try {
				const metrics = calculateMetrics(db);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(metrics, null, 2));
			} catch (error) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Failed to calculate metrics" }));
			}
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	});

	server.listen(port, () => {
		console.log(`\n🚀 Server running at http://${API_HOST}:${port}/metrics`);
	});
}

// CLI Argument Parsing

/**
 * Parse CLI arguments
 */
function parseArgs(): CLIArgs {
	const args = process.argv.slice(2);
	const parsed: CLIArgs = {
		address: DEFAULT_CONTRACT,
		incremental: false,
		serve: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const nextArg = args[i + 1];

		if (arg === "--address" && nextArg) {
			parsed.address = nextArg as Address;
			i++;
		} else if (arg === "--incremental" && nextArg) {
			parsed.incremental = nextArg.toLowerCase() === "true";
			i++;
		} else if (arg === "--serve" && nextArg) {
			parsed.serve = nextArg.toLowerCase() === "true";
			i++;
		} else if (arg === "--export" && nextArg) {
			parsed.export = nextArg;
			i++;
		}
	}

	return parsed;
}

// Main Execution

async function main() {
	console.log("🌟 Citrea Analytics Tool\n");

	const args = parseArgs();
	console.log("Configuration:");
	console.log(`  Contract: ${args.address}`);
	console.log(`  Incremental: ${args.incremental}`);
	console.log(`  Serve API: ${args.serve}`);
	if (args.export) console.log(`  Export to: ${args.export}`);
	console.log();

	// Initialize database
	const db = initDatabase();

	// Create RPC client
	const client = createCitreaClient();

	try {
		// Scan logs
		await scanLogs(db, client, args.address, args.incremental);

		// Calculate metrics
		const metrics = calculateMetrics(db);
		console.log("\n📈 Analytics Summary:");
		console.log(`  Unique Users: ${metrics.uniqueUsers.toLocaleString()}`);
		console.log(`  Total Transactions: ${metrics.uniqueTxCount.toLocaleString()}`);
		console.log(`  Total Gas: ${metrics.totalGas_cBTC} cBTC`);
		console.log(
			`  Top Caller: ${metrics.topCallers[0]?.addr ?? "N/A"} (${metrics.topCallers[0]?.count ?? 0} txs)`
		);

		// Export to JSON if requested
		if (args.export) {
			writeFileSync(args.export, JSON.stringify(metrics, null, 2));
			console.log(`\n💾 Exported metrics to ${args.export}`);
		}

		// Start HTTP server if requested
		if (args.serve) {
			startServer(db);
			// Keep process alive
			await new Promise(() => {}); // Infinite promise
		} else {
			db.close();
		}
	} catch (error) {
		console.error("\n❌ Fatal error:", error);
		db.close();
		process.exit(1);
	}
}

main();
