import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount } from "../src/utils/format";

test("formatAmount does not add a trailing decimal point for zero-decimal tokens", () => {
	assert.equal(formatAmount(9007199254740993n, 0, 2), "9007199254740993");
});
