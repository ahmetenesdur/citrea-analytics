import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTables } from "../src/database/schema";
import { getPairMetrics, getTokenMetrics } from "../src/services/server";

function createFixtureDb() {
	const db = new Database(":memory:");
	createTables(db);
	return db;
}

test("getTokenMetrics preserves inbound, outbound, and daily volume precision", () => {
	const db = createFixtureDb();
	const token = "0x0000000000000000000000000000000000000001";
	const counterparty = "0x0000000000000000000000000000000000000002";
	const amount = "9007199254740993";

	db.prepare(
		"INSERT INTO token_metadata (address, decimals, symbol, coingecko_id) VALUES (?, ?, ?, ?)"
	).run(token, 0, "BIG", null);
	db.prepare(
		"INSERT INTO token_metadata (address, decimals, symbol, coingecko_id) VALUES (?, ?, ?, ?)"
	).run(counterparty, 0, "CTR", null);
	db.prepare("INSERT INTO token_prices (address, price_usd, last_updated) VALUES (?, ?, ?)").run(
		token,
		1,
		1
	);
	db.prepare(
		"INSERT INTO logs (tx_hash, block_number, from_address, gas_used, timestamp) VALUES (?, ?, ?, ?, ?)"
	).run("0xtx1", 1, "0xsender", "0", 1);
	db.prepare(
		"INSERT INTO logs (tx_hash, block_number, from_address, gas_used, timestamp) VALUES (?, ?, ?, ?, ?)"
	).run("0xtx2", 1, "0xsender", "0", 1);
	db.prepare(
		`INSERT INTO swap_events
		(tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run("0xtx1", 0, 1, "0xsender", amount, "1", token, counterparty, "0xdest", 1);
	db.prepare(
		`INSERT INTO swap_events
		(tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run("0xtx2", 1, 1, "0xsender", "1", amount, counterparty, token, "0xdest", 1);

	const metrics = getTokenMetrics(db, token);

	assert.equal(metrics.inbound.formattedAmount, "9007199254740993 BIG");
	assert.equal(metrics.inbound.volumeUsd, "$9007199254740993.00");
	assert.equal(metrics.outbound.formattedAmount, "9007199254740993 BIG");
	assert.equal(metrics.outbound.volumeUsd, "$9007199254740993.00");
	assert.equal(metrics.dailyVolume[0]?.formattedAmount, "9007199254740993 BIG");
	assert.equal(metrics.dailyVolume[0]?.volumeUsd, "$9007199254740993.00");
	db.close();
});

test("getPairMetrics preserves pair aggregate precision", () => {
	const db = createFixtureDb();
	const tokenIn = "0x0000000000000000000000000000000000000001";
	const tokenOut = "0x0000000000000000000000000000000000000002";
	const amount = "9007199254740993";

	db.prepare(
		"INSERT INTO token_metadata (address, decimals, symbol, coingecko_id) VALUES (?, ?, ?, ?)"
	).run(tokenIn, 0, "BIG", null);
	db.prepare(
		"INSERT INTO token_metadata (address, decimals, symbol, coingecko_id) VALUES (?, ?, ?, ?)"
	).run(tokenOut, 0, "OUT", null);
	db.prepare("INSERT INTO token_prices (address, price_usd, last_updated) VALUES (?, ?, ?)").run(
		tokenIn,
		1,
		1
	);
	db.prepare(
		"INSERT INTO logs (tx_hash, block_number, from_address, gas_used, timestamp) VALUES (?, ?, ?, ?, ?)"
	).run("0xtx", 1, "0xsender", "0", 1);
	db.prepare(
		`INSERT INTO swap_events
		(tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run("0xtx", 0, 1, "0xsender", amount, amount, tokenIn, tokenOut, "0xdest", 1);

	const metrics = getPairMetrics(db, tokenIn, tokenOut);

	assert.equal(metrics.volumeIn, "9007199254740993 BIG");
	assert.equal(metrics.volumeOut, "9007199254740993 OUT");
	assert.equal(metrics.totalVolumeUsd, "$9007199254740993.00");
	assert.equal(metrics.dailyStats[0]?.volumeIn, "9007199254740993 BIG");
	assert.equal(metrics.dailyStats[0]?.volumeOut, "9007199254740993 OUT");
	db.close();
});
