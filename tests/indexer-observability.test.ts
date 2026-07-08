import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTables } from "../src/database/schema";
import { setMeta } from "../src/database";
import {
	failScanRun,
	finishScanRun,
	getIndexerHealth,
	listIndexerErrors,
	listScanRuns,
	recordIndexerError,
	resolveIndexerError,
	startScanRun,
} from "../src/services/indexer-observability";

function createFixtureDb() {
	const db = new Database(":memory:");
	createTables(db);
	return db;
}

test("createTables provisions scan run and indexer error observability tables", () => {
	const db = createFixtureDb();

	const scanRun = db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scan_runs'")
		.get();
	const errors = db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'indexer_errors'")
		.get();

	assert.ok(scanRun);
	assert.ok(errors);
	db.close();
});

test("scan run helpers track status transitions and related errors", () => {
	const db = createFixtureDb();
	const runId = startScanRun(db, {
		network: "citrea",
		mode: "incremental",
		startBlock: 10n,
		endBlock: 20n,
	});

	recordIndexerError(db, {
		runId,
		network: "citrea",
		stage: "scan_logs",
		blockStart: 10n,
		blockEnd: 20n,
		txHash: "0xtx",
		error: new Error("rpc failed"),
	});
	failScanRun(db, runId, new Error("scan failed"));

	const run = db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(runId) as any;
	const error = db.prepare("SELECT * FROM indexer_errors WHERE run_id = ?").get(runId) as any;

	assert.equal(run.status, "failed");
	assert.equal(run.error_count, 1);
	assert.match(run.error_message, /scan failed/);
	assert.equal(error.stage, "scan_logs");
	assert.equal(error.tx_hash, "0xtx");
	assert.match(error.error_message, /rpc failed/);
	db.close();
});

test("recordIndexerError coalesces repeated open errors and supports resolution", () => {
	const db = createFixtureDb();
	const firstId = recordIndexerError(db, {
		network: "citrea",
		stage: "fee_backfill",
		txHash: "0xtx",
		error: new Error("rpc failed once"),
	});
	const secondId = recordIndexerError(db, {
		network: "citrea",
		stage: "fee_backfill",
		txHash: "0xtx",
		error: new Error("rpc failed again"),
	});

	assert.equal(secondId, firstId);
	let row = db.prepare("SELECT * FROM indexer_errors WHERE id = ?").get(firstId) as any;
	assert.equal(row.status, "open");
	assert.equal(row.retry_count, 1);
	assert.match(row.error_message, /again/);
	assert.ok(row.last_seen_at >= row.created_at);

	resolveIndexerError(db, firstId, "resolved");
	row = db.prepare("SELECT * FROM indexer_errors WHERE id = ?").get(firstId) as any;
	assert.equal(row.status, "resolved");

	const reopenedId = recordIndexerError(db, {
		network: "citrea",
		stage: "fee_backfill",
		txHash: "0xtx",
		error: new Error("regressed"),
	});
	assert.notEqual(reopenedId, firstId);
	assert.equal(listIndexerErrors(db, { status: "open" }).length, 1);
	db.close();
});

test("list helpers return bounded recent runs and errors", () => {
	const db = createFixtureDb();
	const firstRunId = startScanRun(db, {
		network: "citrea",
		mode: "incremental",
		startBlock: 1n,
		endBlock: 2n,
	});
	const secondRunId = startScanRun(db, {
		network: "citrea",
		mode: "incremental",
		startBlock: 3n,
		endBlock: 4n,
	});
	recordIndexerError(db, {
		runId: secondRunId,
		network: "citrea",
		stage: "scan_range",
		blockStart: 3n,
		blockEnd: 4n,
		error: "boom",
	});

	const runs = listScanRuns(db, { limit: 1 });
	const errors = listIndexerErrors(db, { status: "open", limit: 1 });

	assert.deepEqual(
		runs.map((run) => run.id),
		[secondRunId]
	);
	assert.notEqual(firstRunId, secondRunId);
	assert.equal(errors.length, 1);
	assert.equal(errors[0]?.stage, "scan_range");
	db.close();
});

test("getIndexerHealth reports checkpoint, pending backfills, latest run, and errors", () => {
	const db = createFixtureDb();
	setMeta(db, "lastScannedBlock", "123");
	db.prepare(
		"INSERT INTO logs (tx_hash, block_number, from_address, gas_used, timestamp) VALUES (?, ?, ?, ?, ?)"
	).run("0xtx", 123, "0xsender", "0", 1);

	const runId = startScanRun(db, {
		network: "citrea",
		mode: "incremental",
		startBlock: 100n,
		endBlock: 123n,
	});
	recordIndexerError(db, {
		runId,
		network: "citrea",
		stage: "fee_backfill",
		txHash: "0xtx",
		error: "missing fee",
	});
	finishScanRun(db, runId, { processedLogs: 1, processedSwaps: 0 });

	const health = getIndexerHealth(db);

	assert.equal(health.lastScannedBlock, 123);
	assert.equal(health.pendingFeeBackfills, 1);
	assert.equal(health.pendingSwapBackfills, 1);
	assert.equal(health.totalIndexerErrors, 1);
	assert.equal(health.openIndexerErrors, 1);
	assert.equal(health.latestRun?.id, runId);
	assert.equal(health.latestRun?.status, "completed");
	db.close();
});
