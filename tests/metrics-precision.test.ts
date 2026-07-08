import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTables } from "../src/database/schema";
import { calculateEnhancedMetrics } from "../src/services/server";

function createFixtureDb() {
	const db = new Database(":memory:");
	createTables(db);
	return db;
}

test("calculateEnhancedMetrics preserves raw token amount precision above Number.MAX_SAFE_INTEGER", () => {
	const db = createFixtureDb();
	const token = "0x0000000000000000000000000000000000000001";
	const amount = "9007199254740993";

	db.prepare(
		"INSERT INTO token_metadata (address, decimals, symbol, coingecko_id) VALUES (?, ?, ?, ?)"
	).run(token, 0, "BIG", null);
	db.prepare("INSERT INTO token_prices (address, price_usd, last_updated) VALUES (?, ?, ?)").run(
		token,
		1,
		1
	);
	db.prepare(
		"INSERT INTO logs (tx_hash, block_number, from_address, gas_used, timestamp) VALUES (?, ?, ?, ?, ?)"
	).run("0xtx", 1, "0xsender", "0", 1);
	db.prepare("INSERT INTO fees (tx_hash, fee_wei) VALUES (?, ?)").run("0xtx", amount);
	db.prepare(
		`INSERT INTO swap_events
		(tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run("0xtx", 0, 1, "0xsender", amount, "0", token, token, "0xdest", 1);

	const metrics = calculateEnhancedMetrics(db, {
		currency: { decimals: 0, symbol: "ETH" },
	});

	assert.equal(metrics.cumulativeNetworkFees, "9007199254740993 ETH");
	assert.equal(metrics.averageTransactionFee, "9007199254740993 ETH");
	assert.equal(metrics.cumulativeVolumeUsd, "$9007199254740993.00");
	assert.equal(metrics.tokenMetrics.liquidityIn[0]?.rawAmount, amount);
	assert.equal(metrics.tokenMetrics.liquidityIn[0]?.volumeUsd, "$9007199254740993.00");
	assert.equal(metrics.topTradingPairs[0]?.totalVolumeUsd, "$9007199254740993.00");
	assert.equal(metrics.historicalDailyMetrics[0]?.fees, "9007199254740993 ETH");
	assert.equal(metrics.historicalDailyMetrics[0]?.volumeUsd, "$9007199254740993.00");
	db.close();
});
