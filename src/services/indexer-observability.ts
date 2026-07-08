import type Database from "better-sqlite3";
import { getMeta } from "../database";

export type IndexerErrorStatus = "open" | "resolved" | "ignored";

export interface StartScanRunInput {
	network: string;
	mode: string;
	startBlock: bigint | number;
	endBlock: bigint | number;
}

export interface FinishScanRunInput {
	processedLogs: number;
	processedSwaps: number;
}

export interface RecordIndexerErrorInput {
	runId?: number | null;
	network?: string | null;
	stage: string;
	blockStart?: bigint | number | null;
	blockEnd?: bigint | number | null;
	blockNumber?: bigint | number | null;
	txHash?: string | null;
	item?: unknown;
	error: unknown;
}

export interface IndexerHealth {
	lastScannedBlock: number | null;
	pendingFeeBackfills: number;
	pendingSwapBackfills: number;
	totalIndexerErrors: number;
	openIndexerErrors: number;
	recentIndexerErrors: number;
	latestRun: {
		id: number;
		network: string;
		mode: string;
		startBlock: number | null;
		endBlock: number | null;
		status: string;
		startedAt: string;
		finishedAt: string | null;
		processedLogs: number;
		processedSwaps: number;
		errorCount: number;
		errorMessage: string | null;
	} | null;
}

export interface ListIndexerErrorsOptions {
	status?: IndexerErrorStatus;
	limit?: number;
}

export interface ListScanRunsOptions {
	limit?: number;
}

export interface IndexerErrorSummary {
	id: number;
	runId: number | null;
	network: string | null;
	stage: string;
	blockStart: number | null;
	blockEnd: number | null;
	blockNumber: number | null;
	txHash: string | null;
	item: string | null;
	errorMessage: string;
	status: IndexerErrorStatus;
	retryCount: number;
	createdAt: string;
	lastSeenAt: string;
}

export interface ScanRunSummary {
	id: number;
	network: string;
	mode: string;
	startBlock: number | null;
	endBlock: number | null;
	status: string;
	startedAt: string;
	finishedAt: string | null;
	processedLogs: number;
	processedSwaps: number;
	errorCount: number;
	errorMessage: string | null;
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function toSqlInteger(value: bigint | number | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const numeric = typeof value === "bigint" ? Number(value) : value;
	if (!Number.isSafeInteger(numeric)) {
		throw new RangeError(`Unsafe SQLite integer: ${value.toString()}`);
	}
	return numeric;
}

function serializeError(error: unknown): { message: string; stack: string | null } {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack ?? null };
	}
	if (typeof error === "string") {
		return { message: error, stack: null };
	}
	try {
		return { message: JSON.stringify(error), stack: null };
	} catch {
		return { message: String(error), stack: null };
	}
}

function serializeItem(item: unknown): string | null {
	if (item === undefined || item === null) return null;
	if (typeof item === "string") return item;
	try {
		return JSON.stringify(item);
	} catch {
		return String(item);
	}
}

export function startScanRun(db: Database.Database, input: StartScanRunInput): number {
	const result = db
		.prepare(
			`INSERT INTO scan_runs
			(network, mode, start_block, end_block, status, started_at)
			VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(
			input.network,
			input.mode,
			toSqlInteger(input.startBlock),
			toSqlInteger(input.endBlock),
			"running",
			nowSeconds()
		);
	return Number(result.lastInsertRowid);
}

export function finishScanRun(
	db: Database.Database,
	runId: number,
	input: FinishScanRunInput
): void {
	db.prepare(
		`UPDATE scan_runs
		 SET status = ?, finished_at = ?, processed_logs = ?, processed_swaps = ?
		 WHERE id = ?`
	).run("completed", nowSeconds(), input.processedLogs, input.processedSwaps, runId);
}

export function failScanRun(db: Database.Database, runId: number, error: unknown): void {
	const serialized = serializeError(error);
	db.prepare(
		`UPDATE scan_runs
		 SET status = ?, finished_at = ?, error_message = ?
		 WHERE id = ?`
	).run("failed", nowSeconds(), serialized.message, runId);
}

export function recordIndexerError(db: Database.Database, input: RecordIndexerErrorInput): number {
	const serialized = serializeError(input.error);
	const item = serializeItem(input.item);
	const blockStart = toSqlInteger(input.blockStart);
	const blockEnd = toSqlInteger(input.blockEnd);
	const blockNumber = toSqlInteger(input.blockNumber);
	const now = nowSeconds();
	const existing = db
		.prepare(
			`SELECT id FROM indexer_errors
			 WHERE status = 'open'
			   AND COALESCE(network, '') = COALESCE(?, '')
			   AND stage = ?
			   AND COALESCE(block_start, -1) = COALESCE(?, -1)
			   AND COALESCE(block_end, -1) = COALESCE(?, -1)
			   AND COALESCE(block_number, -1) = COALESCE(?, -1)
			   AND COALESCE(tx_hash, '') = COALESCE(?, '')
			   AND COALESCE(item, '') = COALESCE(?, '')
			 LIMIT 1`
		)
		.get(
			input.network ?? null,
			input.stage,
			blockStart,
			blockEnd,
			blockNumber,
			input.txHash ?? null,
			item
		) as { id: number } | undefined;

	if (existing) {
		db.prepare(
			`UPDATE indexer_errors
			 SET run_id = COALESCE(?, run_id),
			     error_message = ?,
			     error_stack = ?,
			     retry_count = retry_count + 1,
			     last_seen_at = ?
			 WHERE id = ?`
		).run(input.runId ?? null, serialized.message, serialized.stack, now, existing.id);
		if (input.runId !== undefined && input.runId !== null) {
			db.prepare("UPDATE scan_runs SET error_count = error_count + 1 WHERE id = ?").run(
				input.runId
			);
		}
		return existing.id;
	}

	const result = db
		.prepare(
			`INSERT INTO indexer_errors
			(run_id, network, stage, block_start, block_end, block_number, tx_hash, item, error_message, error_stack, status, retry_count, created_at, last_seen_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			input.runId ?? null,
			input.network ?? null,
			input.stage,
			blockStart,
			blockEnd,
			blockNumber,
			input.txHash ?? null,
			item,
			serialized.message,
			serialized.stack,
			"open",
			0,
			now,
			now
		);

	if (input.runId !== undefined && input.runId !== null) {
		db.prepare("UPDATE scan_runs SET error_count = error_count + 1 WHERE id = ?").run(
			input.runId
		);
	}
	return Number(result.lastInsertRowid);
}

function formatTimestamp(seconds: number | null): string | null {
	return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function normalizeLimit(limit: number | undefined, fallback: number, max: number): number {
	if (limit === undefined) return fallback;
	if (!Number.isInteger(limit) || limit < 1) return fallback;
	return Math.min(limit, max);
}

function mapErrorRow(row: {
	id: number;
	run_id: number | null;
	network: string | null;
	stage: string;
	block_start: number | null;
	block_end: number | null;
	block_number: number | null;
	tx_hash: string | null;
	item: string | null;
	error_message: string;
	status: IndexerErrorStatus;
	retry_count: number;
	created_at: number;
	last_seen_at: number;
}): IndexerErrorSummary {
	return {
		id: row.id,
		runId: row.run_id,
		network: row.network,
		stage: row.stage,
		blockStart: row.block_start,
		blockEnd: row.block_end,
		blockNumber: row.block_number,
		txHash: row.tx_hash,
		item: row.item,
		errorMessage: row.error_message,
		status: row.status,
		retryCount: row.retry_count,
		createdAt: formatTimestamp(row.created_at) ?? new Date(0).toISOString(),
		lastSeenAt: formatTimestamp(row.last_seen_at) ?? new Date(0).toISOString(),
	};
}

function mapRunRow(row: {
	id: number;
	network: string;
	mode: string;
	start_block: number | null;
	end_block: number | null;
	status: string;
	started_at: number;
	finished_at: number | null;
	processed_logs: number;
	processed_swaps: number;
	error_count: number;
	error_message: string | null;
}): ScanRunSummary {
	return {
		id: row.id,
		network: row.network,
		mode: row.mode,
		startBlock: row.start_block,
		endBlock: row.end_block,
		status: row.status,
		startedAt: formatTimestamp(row.started_at) ?? new Date(0).toISOString(),
		finishedAt: formatTimestamp(row.finished_at),
		processedLogs: row.processed_logs,
		processedSwaps: row.processed_swaps,
		errorCount: row.error_count,
		errorMessage: row.error_message,
	};
}

export function resolveIndexerError(
	db: Database.Database,
	errorId: number,
	status: Exclude<IndexerErrorStatus, "open"> = "resolved"
): void {
	db.prepare("UPDATE indexer_errors SET status = ?, last_seen_at = ? WHERE id = ?").run(
		status,
		nowSeconds(),
		errorId
	);
}

export function listIndexerErrors(
	db: Database.Database,
	options: ListIndexerErrorsOptions = {}
): IndexerErrorSummary[] {
	const limit = normalizeLimit(options.limit, 25, 100);
	const rows = options.status
		? (db
				.prepare(
					`SELECT * FROM indexer_errors
					 WHERE status = ?
					 ORDER BY last_seen_at DESC, id DESC LIMIT ?`
				)
				.all(options.status, limit) as Parameters<typeof mapErrorRow>[0][])
		: (db
				.prepare("SELECT * FROM indexer_errors ORDER BY last_seen_at DESC, id DESC LIMIT ?")
				.all(limit) as Parameters<typeof mapErrorRow>[0][]);
	return rows.map(mapErrorRow);
}

export function listScanRuns(
	db: Database.Database,
	options: ListScanRunsOptions = {}
): ScanRunSummary[] {
	const limit = normalizeLimit(options.limit, 25, 100);
	const rows = db
		.prepare("SELECT * FROM scan_runs ORDER BY started_at DESC, id DESC LIMIT ?")
		.all(limit) as Parameters<typeof mapRunRow>[0][];
	return rows.map(mapRunRow);
}

export function getIndexerHealth(db: Database.Database): IndexerHealth {
	const lastScannedRaw = getMeta(db, "lastScannedBlock");
	const pendingFeeBackfills = (
		db
			.prepare(
				`SELECT COUNT(*) AS cnt
				 FROM logs l LEFT JOIN fees f ON l.tx_hash = f.tx_hash
				 WHERE f.tx_hash IS NULL`
			)
			.get() as { cnt: number }
	).cnt;
	const pendingSwapBackfills = (
		db
			.prepare(
				`SELECT COUNT(*) AS cnt
				 FROM logs l LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
				 WHERE s.tx_hash IS NULL`
			)
			.get() as { cnt: number }
	).cnt;
	const totalIndexerErrors = (
		db.prepare("SELECT COUNT(*) AS cnt FROM indexer_errors").get() as { cnt: number }
	).cnt;
	const openIndexerErrors = (
		db.prepare("SELECT COUNT(*) AS cnt FROM indexer_errors WHERE status = 'open'").get() as {
			cnt: number;
		}
	).cnt;
	const dayAgo = nowSeconds() - 24 * 60 * 60;
	const recentIndexerErrors = (
		db
			.prepare("SELECT COUNT(*) AS cnt FROM indexer_errors WHERE created_at >= ?")
			.get(dayAgo) as { cnt: number }
	).cnt;
	const latestRunRow = db
		.prepare("SELECT * FROM scan_runs ORDER BY started_at DESC, id DESC LIMIT 1")
		.get() as
		| {
				id: number;
				network: string;
				mode: string;
				start_block: number | null;
				end_block: number | null;
				status: string;
				started_at: number;
				finished_at: number | null;
				processed_logs: number;
				processed_swaps: number;
				error_count: number;
				error_message: string | null;
		  }
		| undefined;

	return {
		lastScannedBlock: lastScannedRaw === null ? null : Number(lastScannedRaw),
		pendingFeeBackfills,
		pendingSwapBackfills,
		totalIndexerErrors,
		openIndexerErrors,
		recentIndexerErrors,
		latestRun: latestRunRow
			? {
					id: latestRunRow.id,
					network: latestRunRow.network,
					mode: latestRunRow.mode,
					startBlock: latestRunRow.start_block,
					endBlock: latestRunRow.end_block,
					status: latestRunRow.status,
					startedAt:
						formatTimestamp(latestRunRow.started_at) ?? new Date(0).toISOString(),
					finishedAt: formatTimestamp(latestRunRow.finished_at),
					processedLogs: latestRunRow.processed_logs,
					processedSwaps: latestRunRow.processed_swaps,
					errorCount: latestRunRow.error_count,
					errorMessage: latestRunRow.error_message,
				}
			: null,
	};
}
