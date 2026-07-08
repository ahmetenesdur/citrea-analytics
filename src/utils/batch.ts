// Process an array of items in chunks with a specified concurrency limit.
export async function processInChunks<T>(
	items: T[],
	concurrency: number,
	task: (item: T) => Promise<void>,
	onProgress?: (processed: number) => void
): Promise<{ processed: number; failed: number; failures: Array<{ item: T; error: unknown }> }> {
	let processed = 0;
	let failed = 0;
	const failures: Array<{ item: T; error: unknown }> = [];

	for (let i = 0; i < items.length; i += concurrency) {
		const chunk = items.slice(i, i + concurrency);
		await Promise.all(
			chunk.map(async (item) => {
				try {
					await task(item);
				} catch (error) {
					failed++;
					failures.push({ item, error });
				} finally {
					processed++;
				}
			})
		);
		if (onProgress) {
			onProgress(processed);
		}
	}

	return { processed, failed, failures };
}
