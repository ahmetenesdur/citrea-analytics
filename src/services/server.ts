import type Database from "better-sqlite3";
import { createServer } from "node:http";
import { ENV } from "../config/env";
import {
	formatScaledUsd,
	formatUsdFromRawAmount,
	parseIntegerAmount,
	usdScaledFromRawAmount,
} from "../utils/amounts";
import { formatAmount } from "../utils/format";
import {
	getIndexerHealth,
	listIndexerErrors,
	listScanRuns,
	type IndexerErrorStatus,
} from "./indexer-observability";
import { Router, sendJson } from "./router";
import { getWalletProfile } from "./wallet";
import { getDecimalsAndSymbols, getPrices } from "./helpers";

interface SwapEventData {
	sender: string;
	amount_in: string;
	amount_out: string;
	token_in: string;
	token_out: string;
	destination: string;
}

interface TokenVolume {
	contractAddress: string;
	rawAmount: string;
	formattedAmount: string;
	volumeUsd: string;
	swapCount: number;
}

interface TokenPairDetail {
	tokenInAddress: string;
	tokenOutAddress: string;
	swapCount: number;
	volumeIn: string;
	volumeOut: string;
	totalVolumeUsd: string;
}

export interface EnhancedMetrics {
	uniqueActiveAddresses: number;
	totalTransactions: number;
	cumulativeNetworkFees: string;
	averageTransactionFee: string;
	totalSwapEvents: number;
	tokenMetrics: {
		liquidityIn: Array<TokenVolume>;
		liquidityOut: Array<TokenVolume>;
	};
	topInteractingAddresses: Array<{ address: string; txCount: number }>;
	topTradingPairs: Array<TokenPairDetail>;
	historicalDailyMetrics: Array<{
		date: string;
		txCount: number;
		uniqueActiveAddresses: number;
		transactionsWithSwaps: number;
		swapEventCount: number;
		fees: string;
		averageFeePerTx: string;
		volumeUsd: string;
	}>;
	swapEvents?: Array<SwapEventData>;
	range: { startBlock: number | null; endBlock: number | null; lastUpdatedAt: string | null };
	executionQuality: {
		averageSlippageMargin: string;
		highSlippageSwaps: number;
		standardSlippageSwaps: number;
	};
	cumulativeVolumeUsd: string;
}

// Metrics Calculation Helpers

type TokenVolumeRow = { token_in?: string; token_out?: string; total: bigint; cnt: number };

function formatVolumeData(
	rows: Array<TokenVolumeRow>,
	isOut: boolean,
	decimalsMap: Map<string, number>,
	symbolMap: Map<string, string>,
	priceMap: Map<string, number>
): TokenVolume[] {
	return rows.map((r) => {
		const token = (isOut ? r.token_out : r.token_in) ?? "";
		const addr = token.toLowerCase();
		const dec = decimalsMap.get(addr) ?? 18;
		const sym = symbolMap.get(addr) ?? "";
		const price = priceMap.get(addr);
		const raw = r.total;

		let volumeUsd = "N/A";
		if (price !== undefined) {
			volumeUsd = formatUsdFromRawAmount(raw, dec, price, 2);
		}

		return {
			contractAddress: token,
			rawAmount: raw.toString(),
			formattedAmount: `${formatAmount(raw, dec, 2)} ${sym}`,
			volumeUsd,
			swapCount: r.cnt,
		};
	});
}

function getTokenVolumeRows(db: Database.Database, isOut: boolean): TokenVolumeRow[] {
	const tokenColumn = isOut ? "token_out" : "token_in";
	const amountColumn = isOut ? "amount_out" : "amount_in";
	const rows = db
		.prepare(`SELECT ${tokenColumn} AS token, ${amountColumn} AS amount FROM swap_events`)
		.all() as Array<{ token: string; amount: string }>;
	const grouped = new Map<string, { total: bigint; cnt: number }>();

	for (const row of rows) {
		const token = row.token.toLowerCase();
		const current = grouped.get(token) ?? { total: 0n, cnt: 0 };
		current.total += parseIntegerAmount(row.amount);
		current.cnt += 1;
		grouped.set(token, current);
	}

	return Array.from(grouped.entries())
		.map(([token, value]) =>
			isOut
				? { token_out: token, total: value.total, cnt: value.cnt }
				: { token_in: token, total: value.total, cnt: value.cnt }
		)
		.sort((a, b) => b.cnt - a.cnt);
}

function getTopTokenPairs(
	db: Database.Database,
	decimalsMap: Map<string, number>,
	symbolMap: Map<string, string>,
	priceMap: Map<string, number>
): TokenPairDetail[] {
	const rawRows = db
		.prepare("SELECT token_in, token_out, amount_in, amount_out FROM swap_events")
		.all() as Array<{
		token_in: string;
		token_out: string;
		amount_in: string;
		amount_out: string;
	}>;
	const grouped = new Map<
		string,
		{ token_in: string; token_out: string; cnt: number; volIn: bigint; volOut: bigint }
	>();

	for (const row of rawRows) {
		const tokenIn = row.token_in.toLowerCase();
		const tokenOut = row.token_out.toLowerCase();
		const key = `${tokenIn}:${tokenOut}`;
		const current = grouped.get(key) ?? {
			token_in: tokenIn,
			token_out: tokenOut,
			cnt: 0,
			volIn: 0n,
			volOut: 0n,
		};
		current.cnt += 1;
		current.volIn += parseIntegerAmount(row.amount_in);
		current.volOut += parseIntegerAmount(row.amount_out);
		grouped.set(key, current);
	}

	const rows = Array.from(grouped.values())
		.sort((a, b) => b.cnt - a.cnt)
		.slice(0, 10);

	return rows.map((r) => {
		const addrIn = r.token_in.toLowerCase();
		const addrOut = r.token_out.toLowerCase();
		const decIn = decimalsMap.get(addrIn) ?? 18;
		const decOut = decimalsMap.get(addrOut) ?? 18;
		const symIn = symbolMap.get(addrIn) ?? "";
		const symOut = symbolMap.get(addrOut) ?? "";
		const priceIn = priceMap.get(addrIn);

		let totalVolumeUsd = "N/A";
		if (priceIn !== undefined) {
			totalVolumeUsd = formatUsdFromRawAmount(r.volIn, decIn, priceIn, 2);
		}

		return {
			tokenInAddress: r.token_in,
			tokenOutAddress: r.token_out,
			swapCount: r.cnt,
			volumeIn: `${formatAmount(r.volIn, decIn, 2)} ${symIn}`,
			volumeOut: `${formatAmount(r.volOut, decOut, 2)} ${symOut}`,
			totalVolumeUsd,
		};
	});
}

function getDailyStats(
	db: Database.Database,
	decimalsMap: Map<string, number>,
	priceMap: Map<string, number>,
	config: { currency: { decimals: number; symbol: string } }
) {
	const statsRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day, COUNT(*) as txCount, COUNT(DISTINCT from_address) as totalUsers FROM logs GROUP BY day ORDER BY day DESC`
		)
		.all() as Array<{ day: string; txCount: number; totalUsers: number }>;

	const feesRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', l.timestamp, 'unixepoch') as day, f.fee_wei as feeWei
			 FROM logs l JOIN fees f ON l.tx_hash = f.tx_hash`
		)
		.all() as Array<{ day: string; feeWei: string }>;

	const feesMap = new Map<string, bigint>();
	for (const r of feesRows) {
		feesMap.set(r.day, (feesMap.get(r.day) ?? 0n) + parseIntegerAmount(r.feeWei));
	}

	const eventRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day, COUNT(*) as swapEventCount FROM swap_events GROUP BY day`
		)
		.all() as Array<{ day: string; swapEventCount: number }>;
	const eventMap = new Map(eventRows.map((r) => [r.day, r.swapEventCount]));

	const volumeRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day, tx_hash, amount_in, token_in FROM swap_events`
		)
		.all() as Array<{ day: string; tx_hash: string; amount_in: string; token_in: string }>;

	const dailyVolumeUsdMap = new Map<string, bigint>();
	const dailySwapTxMap = new Map<string, Set<string>>();

	for (const r of volumeRows) {
		const txSet = dailySwapTxMap.get(r.day) ?? new Set<string>();
		txSet.add(r.tx_hash);
		dailySwapTxMap.set(r.day, txSet);
		const dec = decimalsMap.get(r.token_in.toLowerCase()) ?? 18;
		const price = priceMap.get(r.token_in.toLowerCase());
		if (price !== undefined) {
			const usd = usdScaledFromRawAmount(parseIntegerAmount(r.amount_in), dec, price, 2);
			dailyVolumeUsdMap.set(r.day, (dailyVolumeUsdMap.get(r.day) ?? 0n) + usd);
		}
	}

	return statsRows.map((r) => {
		const vol = dailyVolumeUsdMap.get(r.day);
		const dayFees = feesMap.get(r.day) ?? 0n;
		const avgFee = r.txCount > 0 ? dayFees / BigInt(r.txCount) : 0n;

		return {
			date: r.day,
			txCount: r.txCount,
			uniqueActiveAddresses: r.totalUsers,
			transactionsWithSwaps: dailySwapTxMap.get(r.day)?.size ?? 0,
			swapEventCount: eventMap.get(r.day) ?? 0,
			fees: `${formatAmount(dayFees, config.currency.decimals, 6)} ${config.currency.symbol}`,
			averageFeePerTx: `${formatAmount(avgFee, config.currency.decimals, 6)} ${config.currency.symbol}`,
			volumeUsd: vol !== undefined ? formatScaledUsd(vol, 2) : "N/A",
		};
	});
}

export function calculateEnhancedMetrics(
	db: Database.Database,
	config: { currency: { decimals: number; symbol: string } },
	options?: { includeEvents?: boolean; eventsLimit?: number }
): EnhancedMetrics {
	// 1. Basic Counts
	const totalUsers = (
		db.prepare("SELECT COUNT(DISTINCT from_address) as count FROM logs").get() as any
	).count;
	const totalTxCount = (
		db.prepare("SELECT COUNT(DISTINCT tx_hash) as count FROM logs").get() as any
	).count;
	const totalSwaps = (db.prepare("SELECT COUNT(*) as count FROM swap_events").get() as any).count;

	const totalFeeRows = db.prepare("SELECT fee_wei FROM fees").all() as Array<{ fee_wei: string }>;
	let totalFeesRaw = 0n;
	for (const row of totalFeeRows) {
		totalFeesRaw += parseIntegerAmount(row.fee_wei);
	}
	const totalFees = `${formatAmount(totalFeesRaw, config.currency.decimals, 6)} ${config.currency.symbol}`;
	const avgFeeRaw = totalTxCount > 0 ? totalFeesRaw / BigInt(totalTxCount) : 0n;
	const averageFeePerTx = `${formatAmount(avgFeeRaw, config.currency.decimals, 6)} ${config.currency.symbol}`;

	// 2. Metadata & Prices
	const { decimalsMap, symbolMap } = getDecimalsAndSymbols(db);
	const priceMap = getPrices(db);

	// 3. Volume Analysis
	const inboundVolumeRows = getTokenVolumeRows(db, false);
	const outboundVolumeRows = getTokenVolumeRows(db, true);

	const tokenMetrics = {
		liquidityIn: formatVolumeData(inboundVolumeRows, false, decimalsMap, symbolMap, priceMap),
		liquidityOut: formatVolumeData(outboundVolumeRows, true, decimalsMap, symbolMap, priceMap),
	};

	const rawInboundRows = db
		.prepare("SELECT token_in, amount_in FROM swap_events")
		.all() as Array<{ token_in: string; amount_in: string }>;
	let totalVolumeUsdCents: bigint | null = null;
	for (const r of rawInboundRows) {
		const dec = decimalsMap.get(r.token_in.toLowerCase()) ?? 18;
		const price = priceMap.get(r.token_in.toLowerCase());
		if (price !== undefined) {
			if (totalVolumeUsdCents === null) totalVolumeUsdCents = 0n;
			totalVolumeUsdCents += usdScaledFromRawAmount(
				parseIntegerAmount(r.amount_in),
				dec,
				price,
				2
			);
		}
	}

	// 4. Leaders & Pairs
	const topCallers = db
		.prepare(
			`SELECT from_address as address, COUNT(*) as txCount FROM logs GROUP BY from_address ORDER BY txCount DESC LIMIT 10`
		)
		.all() as any;
	const topTokenPairs = getTopTokenPairs(db, decimalsMap, symbolMap, priceMap);

	// 5. Time-series Stats
	const dailyStats = getDailyStats(db, decimalsMap, priceMap, config);

	// 6. Block Range
	const blockRangeRow = db
		.prepare("SELECT MIN(block_number) as first, MAX(block_number) as last FROM logs")
		.get() as any;
	const lastTsRow = db.prepare("SELECT MAX(timestamp) as last_ts FROM logs").get() as any;
	const range = {
		startBlock: blockRangeRow?.first ?? null,
		endBlock: blockRangeRow?.last ?? null,
		lastUpdatedAt: lastTsRow?.last_ts ? new Date(lastTsRow.last_ts * 1000).toISOString() : null,
	};

	// 7. Slippage
	const slippageStats = db
		.prepare(
			`SELECT COUNT(*) as total, AVG(execution_quality) as avgQuality, SUM(CASE WHEN execution_quality < 0.5 THEN 1 ELSE 0 END) as riskyCount FROM swap_events WHERE execution_quality IS NOT NULL`
		)
		.get() as any;

	const avgQuality = slippageStats?.avgQuality ?? 0;
	const riskyCount = slippageStats?.riskyCount ?? 0;

	return {
		uniqueActiveAddresses: totalUsers,
		totalTransactions: totalTxCount,
		cumulativeNetworkFees: totalFees,
		averageTransactionFee: averageFeePerTx,
		totalSwapEvents: totalSwaps,
		tokenMetrics,
		topInteractingAddresses: topCallers,
		topTradingPairs: topTokenPairs,
		historicalDailyMetrics: dailyStats,

		range,
		executionQuality: {
			averageSlippageMargin: `${Number(avgQuality).toFixed(2)}%`,
			highSlippageSwaps: Number(riskyCount),
			standardSlippageSwaps: Number(slippageStats?.total ?? 0) - Number(riskyCount),
		},
		cumulativeVolumeUsd:
			totalVolumeUsdCents !== null ? formatScaledUsd(totalVolumeUsdCents, 2) : "N/A",
		...(options?.includeEvents
			? {
					swapEvents: db
						.prepare("SELECT * FROM swap_events ORDER BY block_number DESC LIMIT ?")
						.all(options.eventsLimit ?? 10) as any,
				}
			: {}),
	};
}

// Server Lifecycle

const metricsCache = {
	data: null as EnhancedMetrics | null,
	lastUpdated: 0,
	ttl: 10000,
};

function getCachedMetrics(
	db: Database.Database,
	config: { currency: { decimals: number; symbol: string } },
	options?: { includeEvents?: boolean; eventsLimit?: number }
): EnhancedMetrics {
	const now = Date.now();
	if (metricsCache.data && now - metricsCache.lastUpdated < metricsCache.ttl) {
		return metricsCache.data;
	}
	const data = calculateEnhancedMetrics(db, config, options);
	metricsCache.data = data;
	metricsCache.lastUpdated = now;
	return data;
}

export function getTokenMetrics(db: Database.Database, address: string) {
	const addr = address.toLowerCase();
	const { decimalsMap, symbolMap } = getDecimalsAndSymbols(db);
	const priceMap = getPrices(db);
	const dec = decimalsMap.get(addr) ?? 18;
	const sym = symbolMap.get(addr) ?? "UNKNOWN";
	const price = priceMap.get(addr);

	const inboundRows = db
		.prepare("SELECT amount_in FROM swap_events WHERE LOWER(token_in) = ?")
		.all(addr) as Array<{ amount_in: string }>;
	const outboundRows = db
		.prepare("SELECT amount_out FROM swap_events WHERE LOWER(token_out) = ?")
		.all(addr) as Array<{ amount_out: string }>;

	let inboundTotal = 0n;
	for (const row of inboundRows) inboundTotal += parseIntegerAmount(row.amount_in);
	let outboundTotal = 0n;
	for (const row of outboundRows) outboundTotal += parseIntegerAmount(row.amount_out);

	const pairRows = db
		.prepare(
			`SELECT token_in, token_out, COUNT(*) as cnt
			 FROM swap_events
			 WHERE LOWER(token_in) = ? OR LOWER(token_out) = ?
			 GROUP BY token_in, token_out ORDER BY cnt DESC LIMIT 10`
		)
		.all(addr, addr) as Array<{ token_in: string; token_out: string; cnt: number }>;

	const dailyAmountRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day, amount_in
			 FROM swap_events WHERE LOWER(token_in) = ?`
		)
		.all(addr) as Array<{ day: string; amount_in: string }>;
	const dailyMap = new Map<string, { vol: bigint; cnt: number }>();
	for (const row of dailyAmountRows) {
		const current = dailyMap.get(row.day) ?? { vol: 0n, cnt: 0 };
		current.vol += parseIntegerAmount(row.amount_in);
		current.cnt += 1;
		dailyMap.set(row.day, current);
	}
	const dailyRows = Array.from(dailyMap.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.slice(0, 30);

	return {
		address: addr,
		symbol: sym,
		decimals: dec,
		priceUsd: price !== undefined ? `$${price.toFixed(4)}` : "N/A",
		inbound: {
			formattedAmount: `${formatAmount(inboundTotal, dec, 2)} ${sym}`,
			volumeUsd:
				price !== undefined ? formatUsdFromRawAmount(inboundTotal, dec, price, 2) : "N/A",
			swapCount: inboundRows.length,
		},
		outbound: {
			formattedAmount: `${formatAmount(outboundTotal, dec, 2)} ${sym}`,
			volumeUsd:
				price !== undefined ? formatUsdFromRawAmount(outboundTotal, dec, price, 2) : "N/A",
			swapCount: outboundRows.length,
		},
		topPairs: pairRows.map((p) => ({
			tokenIn: p.token_in,
			tokenOut: p.token_out,
			symbolIn: symbolMap.get(p.token_in.toLowerCase()) ?? "UNKNOWN",
			symbolOut: symbolMap.get(p.token_out.toLowerCase()) ?? "UNKNOWN",
			swapCount: p.cnt,
		})),
		dailyVolume: dailyRows.map(([day, data]) => ({
			date: day,
			formattedAmount: `${formatAmount(data.vol, dec, 2)} ${sym}`,
			volumeUsd:
				price !== undefined ? formatUsdFromRawAmount(data.vol, dec, price, 2) : "N/A",
			swapCount: data.cnt,
		})),
	};
}

export function getPairMetrics(
	db: Database.Database,
	tokenInAddress: string,
	tokenOutAddress: string
) {
	const tokenIn = tokenInAddress.toLowerCase();
	const tokenOut = tokenOutAddress.toLowerCase();
	const { decimalsMap, symbolMap } = getDecimalsAndSymbols(db);
	const priceMap = getPrices(db);

	const decIn = decimalsMap.get(tokenIn) ?? 18;
	const decOut = decimalsMap.get(tokenOut) ?? 18;
	const symIn = symbolMap.get(tokenIn) ?? "UNKNOWN";
	const symOut = symbolMap.get(tokenOut) ?? "UNKNOWN";
	const priceIn = priceMap.get(tokenIn);

	const pairRows = db
		.prepare(
			`SELECT amount_in, amount_out
			 FROM swap_events WHERE LOWER(token_in) = ? AND LOWER(token_out) = ?`
		)
		.all(tokenIn, tokenOut) as Array<{ amount_in: string; amount_out: string }>;
	let volumeIn = 0n;
	let volumeOut = 0n;
	for (const row of pairRows) {
		volumeIn += parseIntegerAmount(row.amount_in);
		volumeOut += parseIntegerAmount(row.amount_out);
	}

	const dailyAmountRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day, amount_in, amount_out
			 FROM swap_events WHERE LOWER(token_in) = ? AND LOWER(token_out) = ?`
		)
		.all(tokenIn, tokenOut) as Array<{ day: string; amount_in: string; amount_out: string }>;
	const dailyMap = new Map<string, { cnt: number; volIn: bigint; volOut: bigint }>();
	for (const row of dailyAmountRows) {
		const current = dailyMap.get(row.day) ?? { cnt: 0, volIn: 0n, volOut: 0n };
		current.cnt += 1;
		current.volIn += parseIntegerAmount(row.amount_in);
		current.volOut += parseIntegerAmount(row.amount_out);
		dailyMap.set(row.day, current);
	}
	const dailyRows = Array.from(dailyMap.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.slice(0, 30);

	const topTraders = db
		.prepare(
			`SELECT sender, COUNT(*) as cnt
			 FROM swap_events WHERE LOWER(token_in) = ? AND LOWER(token_out) = ?
			 GROUP BY sender ORDER BY cnt DESC LIMIT 10`
		)
		.all(tokenIn, tokenOut) as Array<{ sender: string; cnt: number }>;

	return {
		tokenIn,
		tokenOut,
		symbolIn: symIn,
		symbolOut: symOut,
		totalSwaps: pairRows.length,
		volumeIn: `${formatAmount(volumeIn, decIn, 2)} ${symIn}`,
		volumeOut: `${formatAmount(volumeOut, decOut, 2)} ${symOut}`,
		totalVolumeUsd:
			priceIn !== undefined ? formatUsdFromRawAmount(volumeIn, decIn, priceIn, 2) : "N/A",
		dailyStats: dailyRows.map(([day, data]) => ({
			date: day,
			swapCount: data.cnt,
			volumeIn: `${formatAmount(data.volIn, decIn, 2)} ${symIn}`,
			volumeOut: `${formatAmount(data.volOut, decOut, 2)} ${symOut}`,
		})),
		topTraders: topTraders.map((t) => ({ address: t.sender, swapCount: t.cnt })),
	};
}

const INDEXER_ERROR_STATUSES: IndexerErrorStatus[] = ["open", "resolved", "ignored"];

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isIndexerErrorStatus(value: string): value is IndexerErrorStatus {
	return INDEXER_ERROR_STATUSES.includes(value as IndexerErrorStatus);
}

export function getHealthErrorsResponse(
	db: Database.Database,
	query: Record<string, string>
): { statusCode: number; body: any } {
	const status = query.status;
	if (status && !isIndexerErrorStatus(status)) {
		return { statusCode: 400, body: { error: "Invalid status" } };
	}
	const parsedStatus = status ? (status as IndexerErrorStatus) : undefined;
	const options: { status?: IndexerErrorStatus; limit?: number } = {};
	if (parsedStatus) options.status = parsedStatus;
	const limit = parsePositiveInteger(query.limit);
	if (limit !== undefined) options.limit = limit;
	return {
		statusCode: 200,
		body: {
			status: parsedStatus ?? "all",
			data: listIndexerErrors(db, options),
		},
	};
}

export function getHealthRunsResponse(
	db: Database.Database,
	query: Record<string, string>
): { statusCode: number; body: any } {
	const options: { limit?: number } = {};
	const limit = parsePositiveInteger(query.limit);
	if (limit !== undefined) options.limit = limit;
	return {
		statusCode: 200,
		body: { data: listScanRuns(db, options) },
	};
}

export function startServer(
	db: Database.Database,
	config: { currency: { decimals: number; symbol: string }; name?: string },
	port = ENV.API_PORT
): void {
	const router = new Router();
	const serverStartTime = Date.now();

	// GET /metrics — Full metrics (existing behavior)
	router.get("/metrics", (_req, res) => {
		const metrics = getCachedMetrics(db, config, {
			includeEvents: ENV.INCLUDE_EVENTS,
			eventsLimit: ENV.EVENTS_LIMIT,
		});
		sendJson(res, metrics);
	});

	// GET /metrics/daily?from=YYYY-MM-DD&to=YYYY-MM-DD
	router.get("/metrics/daily", (_req, res, _params, query) => {
		const metrics = getCachedMetrics(db, config);
		const from = query.from || "1970-01-01";
		const to = query.to || "9999-12-31";
		const filtered = metrics.historicalDailyMetrics.filter(
			(d) => d.date >= from && d.date <= to
		);
		sendJson(res, { from, to, count: filtered.length, data: filtered });
	});

	// GET /metrics/token/:address
	router.get("/metrics/token/:address", (_req, res, params) => {
		sendJson(res, getTokenMetrics(db, params.address ?? ""));
	});

	// GET /metrics/pair/:tokenIn/:tokenOut
	router.get("/metrics/pair/:tokenIn/:tokenOut", (_req, res, params) => {
		sendJson(res, getPairMetrics(db, params.tokenIn ?? "", params.tokenOut ?? ""));
	});

	// GET /metrics/wallet/:address
	router.get("/metrics/wallet/:address", (_req, res, params) => {
		const profile = getWalletProfile(db, params.address ?? "", config);
		if (!profile) {
			sendJson(res, { error: "Address not found" }, 404);
			return;
		}
		sendJson(res, profile);
	});

	// GET /health
	router.get("/health", (_req, res) => {
		const totalTx = (db.prepare("SELECT COUNT(*) as cnt FROM logs").get() as any)?.cnt ?? 0;
		const totalSwaps =
			(db.prepare("SELECT COUNT(*) as cnt FROM swap_events").get() as any)?.cnt ?? 0;
		const blockRow = db.prepare("SELECT MAX(block_number) as last FROM logs").get() as any;
		const tsRow = db.prepare("SELECT MAX(timestamp) as last_ts FROM logs").get() as any;
		const indexer = getIndexerHealth(db);

		sendJson(res, {
			status: "ok",
			network: config.name ?? "unknown",
			database: {
				totalTransactions: totalTx,
				totalSwapEvents: totalSwaps,
				lastBlock: blockRow?.last ?? null,
				lastUpdatedAt: tsRow?.last_ts ? new Date(tsRow.last_ts * 1000).toISOString() : null,
			},
			indexer,
			uptime: Math.floor((Date.now() - serverStartTime) / 1000),
		});
	});

	// GET /health/errors?status=open&limit=25
	router.get("/health/errors", (_req, res, _params, query) => {
		const response = getHealthErrorsResponse(db, query);
		sendJson(res, response.body, response.statusCode);
	});

	// GET /health/runs?limit=25
	router.get("/health/runs", (_req, res, _params, query) => {
		const response = getHealthRunsResponse(db, query);
		sendJson(res, response.body, response.statusCode);
	});

	// Create server with router
	const server = createServer(async (req, res) => {
		const handled = await router.handle(req, res);
		if (!handled) {
			sendJson(res, { error: "Not found" }, 404);
		}
	});

	server.listen(port, () => {
		console.log(`\n[Server] Metrics API running at http://${ENV.API_HOST}:${port}`);
		console.log(`  Endpoints:`);
		console.log(`    GET /metrics`);
		console.log(`    GET /metrics/daily?from=YYYY-MM-DD&to=YYYY-MM-DD`);
		console.log(`    GET /metrics/token/:address`);
		console.log(`    GET /metrics/pair/:tokenIn/:tokenOut`);
		console.log(`    GET /metrics/wallet/:address`);
		console.log(`    GET /health`);
		console.log(`    GET /health/errors?status=open&limit=25`);
		console.log(`    GET /health/runs?limit=25`);
	});
}
