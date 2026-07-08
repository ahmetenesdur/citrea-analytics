import { test } from "node:test";
import assert from "node:assert/strict";
import {
	formatUsdFromRawAmount,
	parseIntegerAmount,
	sumIntegerAmounts,
	usdScaledFromRawAmount,
} from "../src/utils/amounts";

test("sumIntegerAmounts sums integer strings without converting through Number", () => {
	assert.equal(sumIntegerAmounts(["9007199254740993", "7"]), 9007199254741000n);
});

test("parseIntegerAmount rejects unsafe number inputs", () => {
	assert.throws(() => parseIntegerAmount(Number.MAX_SAFE_INTEGER + 1), /Unsafe integer amount/);
});

test("usdScaledFromRawAmount converts raw token amounts to rounded USD minor units", () => {
	assert.equal(usdScaledFromRawAmount(9007199254740993n, 0, 1, 2), 900719925474099300n);
	assert.equal(usdScaledFromRawAmount(123456789n, 6, 2.5, 2), 30864n);
});

test("formatUsdFromRawAmount formats precise USD values", () => {
	assert.equal(formatUsdFromRawAmount(9007199254740993n, 0, 1), "$9007199254740993.00");
	assert.equal(formatUsdFromRawAmount(123456789n, 6, 2.5), "$308.64");
});
