#!/usr/bin/env tsx

import "dotenv/config";
import { createPublicClient, http, type Address, type Log, decodeEventLog } from "viem";
import { defineChain } from "viem/utils";
import Database from "better-sqlite3";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { citreaRouterAbi } from "./abi";

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
	rpcUrls: { default: { http: [CITREA_RPC_URL] } },
	blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.citrea.xyz" } },
});

interface SwapEventData {
	sender: string;
	amount_in: string;
	amount_out: string;
	token_in: string;
	token_out: string;
	destination: string;
}

interface TokenVolume {
	token: string;
	totalAmount: string;
	normalizedAmount: string;
	swapCount: number;
}

interface TokenPairDetail {
	tokenIn: string;
	tokenOut: string;
	swapCount: number;
	volumeIn: string;
	volumeOut: string;
}

interface EnhancedMetrics {
	uniqueUsers: number;
	uniqueTxCount: number;
	totalGas_cBTC: string;
	totalSwaps: number;
	volumeByToken: {
		inbound: Array<TokenVolume>;
		outbound: Array<TokenVolume>;
	};
	topCallers: Array<{ addr: string; count: number }>;
	topTokenPairs: Array<TokenPairDetail>;
	dailyStats: Array<{ day: string; tx: number; uniqueUsers: number; swaps: number }>;
	swapEvents: Array<SwapEventData>;
}

// Initialize database with events table
function initDatabase(): Database.Database {
	const db = new Database(DB_FILE);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");

	db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      tx_hash TEXT PRIMARY KEY,
      block_number INTEGER NOT NULL,
      from_address TEXT NOT NULL,
      gas_used TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS swap_events (
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
    
    CREATE INDEX IF NOT EXISTS idx_block_number ON logs(block_number);
    CREATE INDEX IF NOT EXISTS idx_from_address ON logs(from_address);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_token_pair ON swap_events(token_in, token_out);
    CREATE INDEX IF NOT EXISTS idx_sender ON swap_events(sender);
    
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

	console.log("✓ Database initialized with event decoding support");
	return db;
}

function getMeta(db: Database.Database, key: string): string | null {
	const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

function setMeta(db: Database.Database, key: string, value: string): void {
	db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

function createCitreaClient() {
	return createPublicClient({
		chain: CITREA_TESTNET,
		transport: http(CITREA_RPC_URL, {
			retryCount: MAX_RETRIES,
			retryDelay: RETRY_DELAY_MS,
		}),
	});
}

async function fetchLogsWithRetry(
	client: ReturnType<typeof createCitreaClient>,
	address: Address,
	fromBlock: bigint,
	toBlock: bigint,
	retries = MAX_RETRIES
): Promise<Log[]> {
	try {
		return await client.getLogs({ address, fromBlock, toBlock });
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

async function scanLogs(
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

	const insertLog = db.prepare(`
    INSERT OR IGNORE INTO logs (tx_hash, block_number, from_address, gas_used, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

	const insertSwap = db.prepare(`
    INSERT OR IGNORE INTO swap_events 
    (tx_hash, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

	let currentBlock = startBlock;
	let totalLogs = 0;
	let totalSwaps = 0;

	while (currentBlock <= latestBlock) {
		const endBlock =
			currentBlock + BATCH_SIZE > latestBlock ? latestBlock : currentBlock + BATCH_SIZE - 1n;

		try {
			const logs = await fetchLogsWithRetry(client, address, currentBlock, endBlock);

			if (logs.length > 0) {
				await Promise.all(
					logs.map(async (log) => {
						const [receipt, block] = await Promise.all([
							client.getTransactionReceipt({ hash: log.transactionHash! }),
							client.getBlock({ blockNumber: log.blockNumber! }),
						]);

						insertLog.run(
							log.transactionHash!,
							Number(log.blockNumber!),
							receipt.from.toLowerCase(),
							receipt.gasUsed.toString(),
							Number(block.timestamp)
						);

						// Decode Swap events
						try {
							const decoded = decodeEventLog({
								abi: citreaRouterAbi,
								data: log.data,
								topics: log.topics,
							});

							if (decoded.eventName === "Swap") {
								const args = decoded.args as unknown as SwapEventData;
								insertSwap.run(
									log.transactionHash!,
									Number(log.blockNumber!),
									args.sender.toLowerCase(),
									args.amount_in.toString(),
									args.amount_out.toString(),
									args.token_in.toLowerCase(),
									args.token_out.toLowerCase(),
									args.destination.toLowerCase(),
									Number(block.timestamp)
								);
								totalSwaps++;
							}
						} catch {
							// Not a Swap event or decoding failed
						}
					})
				);

				totalLogs += logs.length;
			}

			const progress = Number(((endBlock - startBlock) * 100n) / (latestBlock - startBlock));
			console.log(
				`  Block ${endBlock.toLocaleString()} | ${logs.length} logs | ${totalSwaps} swaps | ${progress.toFixed(1)}% complete`
			);

			currentBlock = endBlock + 1n;
		} catch (error) {
			console.error(`❌ Error scanning blocks ${currentBlock}-${endBlock}:`, error);
			throw error;
		}
	}

	setMeta(db, "lastScannedBlock", latestBlock.toString());
	console.log(`\n✓ Scan complete! Indexed ${totalLogs} transactions, ${totalSwaps} swap events`);
}

function calculateEnhancedMetrics(db: Database.Database): EnhancedMetrics {
	const uniqueUsers = db
		.prepare("SELECT COUNT(DISTINCT from_address) as count FROM logs")
		.get() as { count: number };
	const uniqueTxCount = db.prepare("SELECT COUNT(*) as count FROM logs").get() as {
		count: number;
	};
	const totalGasRow = db
		.prepare("SELECT SUM(CAST(gas_used AS REAL)) as total FROM logs")
		.get() as { total: number };
	const totalGas_cBTC = (totalGasRow.total / 1e18).toFixed(4);

	const totalSwaps = db.prepare("SELECT COUNT(*) as count FROM swap_events").get() as {
		count: number;
	};

	// Volume by token (inbound) - separated by token, ordered by swap count
	const volumeInByToken = db
		.prepare(
			`
    SELECT 
      token_in as token,
      SUM(CAST(amount_in AS REAL)) as total,
      COUNT(*) as count
    FROM swap_events
    GROUP BY token_in
    ORDER BY count DESC
  `
		)
		.all() as Array<{ token: string; total: number; count: number }>;

	// Volume by token (outbound) - separated by token, ordered by swap count
	const volumeOutByToken = db
		.prepare(
			`
    SELECT 
      token_out as token,
      SUM(CAST(amount_out AS REAL)) as total,
      COUNT(*) as count
    FROM swap_events
    GROUP BY token_out
    ORDER BY count DESC
  `
		)
		.all() as Array<{ token: string; total: number; count: number }>;

	// Convert to readable format with proper decimals
	const volumeByToken = {
		inbound: volumeInByToken.map((v) => ({
			token: v.token,
			totalAmount: v.total.toFixed(0),
			normalizedAmount: `${(v.total / 1e18).toFixed(6)} (assuming 18 decimals)`,
			swapCount: v.count,
		})),
		outbound: volumeOutByToken.map((v) => ({
			token: v.token,
			totalAmount: v.total.toFixed(0),
			normalizedAmount: `${(v.total / 1e18).toFixed(6)} (assuming 18 decimals)`,
			swapCount: v.count,
		})),
	};

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

	// Token pairs with separate in/out volumes
	const topTokenPairsData = db
		.prepare(
			`
    SELECT 
      token_in,
      token_out,
      COUNT(*) as count,
      SUM(CAST(amount_in AS REAL)) as volume_in,
      SUM(CAST(amount_out AS REAL)) as volume_out
    FROM swap_events
    GROUP BY token_in, token_out
    ORDER BY count DESC
    LIMIT 10
  `
		)
		.all() as Array<{
		token_in: string;
		token_out: string;
		count: number;
		volume_in: number;
		volume_out: number;
	}>;

	const topTokenPairs = topTokenPairsData.map((p) => ({
		tokenIn: p.token_in,
		tokenOut: p.token_out,
		swapCount: p.count,
		volumeIn: `${(p.volume_in / 1e18).toFixed(6)} (${p.token_in.slice(0, 8)}...)`,
		volumeOut: `${(p.volume_out / 1e18).toFixed(6)} (${p.token_out.slice(0, 8)}...)`,
	}));

	const dailyStats = db
		.prepare(
			`
    SELECT 
      strftime('%Y-%m-%d', l.timestamp, 'unixepoch') as day,
      COUNT(DISTINCT l.tx_hash) as tx,
      COUNT(DISTINCT l.from_address) as uniqueUsers,
      COUNT(DISTINCT s.tx_hash) as swaps
    FROM logs l
    LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
    GROUP BY day
    ORDER BY day DESC
  `
		)
		.all() as Array<{ day: string; tx: number; uniqueUsers: number; swaps: number }>;

	const swapEvents = db
		.prepare(
			`
    SELECT sender, amount_in, amount_out, token_in, token_out, destination
    FROM swap_events
    ORDER BY block_number DESC
    LIMIT 100
  `
		)
		.all() as Array<SwapEventData>;

	return {
		uniqueUsers: uniqueUsers.count,
		uniqueTxCount: uniqueTxCount.count,
		totalGas_cBTC,
		totalSwaps: totalSwaps.count,
		volumeByToken,
		topCallers,
		topTokenPairs,
		dailyStats,
		swapEvents,
	};
}

function startServer(db: Database.Database, port = API_PORT): void {
	const server = createServer((req, res) => {
		if (req.url === "/metrics" && req.method === "GET") {
			try {
				const metrics = calculateEnhancedMetrics(db);
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

function parseArgs(): { address: Address; incremental: boolean; serve: boolean; export?: string } {
	const args = process.argv.slice(2);
	const parsed: { address: Address; incremental: boolean; serve: boolean; export?: string } = {
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

async function main() {
	console.log("🌟 Citrea Analytics Tool (Enhanced with Event Decoding)\n");

	const args = parseArgs();
	console.log("Configuration:");
	console.log(`  Contract: ${args.address}`);
	console.log(`  Incremental: ${args.incremental}`);
	console.log(`  Serve API: ${args.serve}`);
	if (args.export) console.log(`  Export to: ${args.export}`);
	console.log();

	const db = initDatabase();
	const client = createCitreaClient();

	try {
		await scanLogs(db, client, args.address, args.incremental);

		const metrics = calculateEnhancedMetrics(db);
		console.log("\n📈 Analytics Summary:");
		console.log(`  Unique Users: ${metrics.uniqueUsers.toLocaleString()}`);
		console.log(`  Total Transactions: ${metrics.uniqueTxCount.toLocaleString()}`);
		console.log(`  Total Swaps: ${metrics.totalSwaps.toLocaleString()}`);
		console.log(`  Total Gas: ${metrics.totalGas_cBTC} cBTC`);
		console.log(`\n  📊 Volume by Token (Top 3 Inbound):`);
		metrics.volumeByToken.inbound.slice(0, 3).forEach((v, i) => {
			console.log(`    ${i + 1}. ${v.token.slice(0, 10)}...`);
			console.log(`       Amount: ${v.normalizedAmount}`);
			console.log(`       Swaps: ${v.swapCount.toLocaleString()}`);
		});
		console.log(
			`\n  Top Token Pair: ${metrics.topTokenPairs[0]?.tokenIn.slice(0, 8)}... → ${metrics.topTokenPairs[0]?.tokenOut.slice(0, 8)}... (${metrics.topTokenPairs[0]?.swapCount ?? 0} swaps)`
		);

		if (args.export) {
			writeFileSync(args.export, JSON.stringify(metrics, null, 2));
			console.log(`\n💾 Exported metrics to ${args.export}`);
		}

		if (args.serve) {
			startServer(db);
			await new Promise(() => {});
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
