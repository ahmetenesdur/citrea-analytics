export function sanitizeDecimals(dec: number | bigint): number {
	const n = Number(dec);
	if (!Number.isFinite(n) || n <= 0 || n > 36) return 18;
	return n;
}

export function formatAmount(amount: bigint, decimals: number, fractionDigits = 6): string {
	const base = 10n ** BigInt(decimals);
	const integer = amount / base;
	const fraction = amount % base;
	if (decimals === 0) return integer.toString();
	const fracStr = fraction.toString().padStart(decimals, "0");

	// For small amounts (integer part is 0), show at least 2 significant digits
	if (integer === 0n && fraction > 0n) {
		// Find first non-zero digit position
		const firstNonZero = fracStr.search(/[1-9]/);
		if (firstNonZero >= 0) {
			// Show at least 2 significant digits after first non-zero
			const minDigits = Math.min(firstNonZero + 2, decimals);
			const effectiveDigits = Math.max(fractionDigits, minDigits);
			return `${integer.toString()}.${fracStr.slice(0, effectiveDigits)}`;
		}
	}

	return `${integer.toString()}.${fracStr.slice(0, fractionDigits)}`;
}
