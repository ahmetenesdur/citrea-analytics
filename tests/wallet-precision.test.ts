import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTables } from "../src/database/schema";
import { getWalletProfile } from "../src/services/wallet";

function createFixtureDb() {
	const db = new Database(":memory:");
	createTables(db);
	return db;
}

test("getWalletProfile preserves fee and volume precision above Number.MAX_SAFE_INTEGER", () => {
	const db = createFixtureDb();
	const wallet = "0xsender";
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
	).run("0xtx", 1, wallet, "0", 1);
	db.prepare("INSERT INTO fees (tx_hash, fee_wei) VALUES (?, ?)").run("0xtx", amount);
	db.prepare(
		`INSERT INTO swap_events
		(tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run("0xtx", 0, 1, wallet, amount, "0", token, token, "0xdest", 1);

	const profile = getWalletProfile(db, wallet, { currency: { decimals: 0, symbol: "ETH" } });

	assert.equal(profile?.totalFeesPaid, "9007199254740993 ETH");
	assert.equal(profile?.totalVolumeUsd, "$9007199254740993.00");
	assert.equal(profile?.topPairs[0]?.totalVolumeUsd, "$9007199254740993.00");
	assert.equal(profile?.tokensTraded[0]?.totalIn, "9007199254740993 BIG");
	assert.equal(profile?.dailyActivity[0]?.volumeUsd, "$9007199254740993.00");
	db.close();
});
