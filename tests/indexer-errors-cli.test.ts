import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTables } from "../src/database/schema";
import { recordIndexerError } from "../src/services/indexer-observability";
import { parseIndexerErrorsArgs, runIndexerErrorsCommand } from "../src/scripts/indexer-errors";

function createFixtureDb() {
	const db = new Database(":memory:");
	createTables(db);
	return db;
}

test("parseIndexerErrorsArgs defaults to listing open Citrea errors", () => {
	assert.deepEqual(parseIndexerErrorsArgs(["list"]), {
		command: "list",
		network: "citrea",
		status: "open",
		limit: 25,
	});
});

test("runIndexerErrorsCommand lists only requested lifecycle errors", () => {
	const db = createFixtureDb();
	recordIndexerError(db, {
		network: "citrea",
		stage: "fee_backfill",
		txHash: "0xopen",
		error: "open error",
	});
	const resolvedId = recordIndexerError(db, {
		network: "citrea",
		stage: "scan_range",
		txHash: "0xresolved",
		error: "resolved error",
	});
	runIndexerErrorsCommand(db, ["resolve", String(resolvedId)]);

	const result = runIndexerErrorsCommand(db, ["list", "--status", "open", "--limit", "10"]);

	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /fee_backfill/);
	assert.match(result.stdout, /0xopen/);
	assert.doesNotMatch(result.stdout, /0xresolved/);
	db.close();
});

test("runIndexerErrorsCommand resolves and ignores errors by id", () => {
	const db = createFixtureDb();
	const resolvedId = recordIndexerError(db, {
		network: "citrea",
		stage: "fee_backfill",
		txHash: "0xresolve",
		error: "resolve me",
	});
	const ignoredId = recordIndexerError(db, {
		network: "citrea",
		stage: "scan_range",
		txHash: "0xignore",
		error: "ignore me",
	});

	assert.equal(runIndexerErrorsCommand(db, ["resolve", String(resolvedId)]).exitCode, 0);
	assert.equal(runIndexerErrorsCommand(db, ["ignore", String(ignoredId)]).exitCode, 0);

	const rows = db.prepare("SELECT id, status FROM indexer_errors ORDER BY id").all() as Array<{
		id: number;
		status: string;
	}>;
	assert.deepEqual(rows, [
		{ id: resolvedId, status: "resolved" },
		{ id: ignoredId, status: "ignored" },
	]);
	db.close();
});
