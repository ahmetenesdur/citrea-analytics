import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTables } from "../src/database/schema";
import {
	recordIndexerError,
	resolveIndexerError,
	startScanRun,
} from "../src/services/indexer-observability";
import { getHealthErrorsResponse, getHealthRunsResponse } from "../src/services/server";

function createFixtureDb() {
	const db = new Database(":memory:");
	createTables(db);
	return db;
}

test("getHealthErrorsResponse filters lifecycle errors by status and caps limits", () => {
	const db = createFixtureDb();
	const resolvedId = recordIndexerError(db, {
		network: "citrea",
		stage: "fee_backfill",
		txHash: "0xresolved",
		error: "resolved",
	});
	resolveIndexerError(db, resolvedId, "resolved");
	recordIndexerError(db, {
		network: "citrea",
		stage: "swap_event_backfill",
		txHash: "0xopen1",
		error: "open 1",
	});
	recordIndexerError(db, {
		network: "citrea",
		stage: "token_metadata_backfill",
		item: "0xtoken",
		error: "open 2",
	});

	const response = getHealthErrorsResponse(db, { status: "open", limit: "1" });

	assert.equal(response.statusCode, 200);
	assert.equal(response.body.status, "open");
	assert.equal(response.body.data.length, 1);
	assert.equal(response.body.data[0]?.status, "open");
	db.close();
});

test("getHealthErrorsResponse rejects invalid status values", () => {
	const db = createFixtureDb();
	const response = getHealthErrorsResponse(db, { status: "closed" });

	assert.equal(response.statusCode, 400);
	assert.deepEqual(response.body, { error: "Invalid status" });
	db.close();
});

test("getHealthRunsResponse returns bounded recent scan runs", () => {
	const db = createFixtureDb();
	startScanRun(db, { network: "citrea", mode: "incremental", startBlock: 1n, endBlock: 2n });
	const latestRunId = startScanRun(db, {
		network: "citrea",
		mode: "incremental",
		startBlock: 3n,
		endBlock: 4n,
	});

	const response = getHealthRunsResponse(db, { limit: "1" });

	assert.equal(response.statusCode, 200);
	assert.equal(response.body.data.length, 1);
	assert.equal(response.body.data[0]?.id, latestRunId);
	db.close();
});
