import { test } from "node:test";
import assert from "node:assert/strict";
import { processInChunks } from "../src/utils/batch";

test("processInChunks returns failed items and errors instead of losing failure context", async () => {
	const result = await processInChunks([1, 2, 3], 2, async (item) => {
		if (item === 2) throw new Error("boom");
	});

	assert.equal(result.processed, 3);
	assert.equal(result.failed, 1);
	assert.deepEqual(
		result.failures.map((failure) => failure.item),
		[2]
	);
	assert.match(String(result.failures[0]?.error), /boom/);
});
