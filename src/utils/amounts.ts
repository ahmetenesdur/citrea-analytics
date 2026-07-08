const PRICE_SCALE = 100_000_000n;

function assertValidDecimals(decimals: number): void {
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
		throw new RangeError(`Invalid token decimals: ${decimals}`);
	}
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
	if (denominator <= 0n) {
		throw new RangeError("Denominator must be positive");
	}

	const sign = numerator < 0n ? -1n : 1n;
	const absolute = numerator < 0n ? -numerator : numerator;
	const rounded = (absolute + denominator / 2n) / denominator;
	return rounded * sign;
}

export function parseIntegerAmount(value: string | number | bigint | null | undefined): bigint {
	if (value === null || value === undefined) return 0n;
	if (typeof value === "bigint") return value;
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) {
			throw new RangeError(`Unsafe integer amount: ${value}`);
		}
		return BigInt(value);
	}

	const trimmed = value.trim();
	if (trimmed === "") return 0n;
	return BigInt(trimmed);
}

export function sumIntegerAmounts(
	values: Iterable<string | number | bigint | null | undefined>
): bigint {
	let total = 0n;
	for (const value of values) {
		total += parseIntegerAmount(value);
	}
	return total;
}

export function usdScaledFromRawAmount(
	rawAmount: bigint,
	decimals: number,
	priceUsd: number,
	fractionDigits = 2
): bigint {
	assertValidDecimals(decimals);
	if (!Number.isFinite(priceUsd) || priceUsd < 0) {
		throw new RangeError(`Invalid USD price: ${priceUsd}`);
	}
	if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 12) {
		throw new RangeError(`Invalid fraction digits: ${fractionDigits}`);
	}

	const priceScaled = BigInt(Math.round(priceUsd * Number(PRICE_SCALE)));
	const outputScale = 10n ** BigInt(fractionDigits);
	const tokenScale = 10n ** BigInt(decimals);
	return roundDiv(rawAmount * priceScaled * outputScale, tokenScale * PRICE_SCALE);
}

export function formatScaledUsd(scaledAmount: bigint, fractionDigits = 2): string {
	if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 12) {
		throw new RangeError(`Invalid fraction digits: ${fractionDigits}`);
	}

	const outputScale = 10n ** BigInt(fractionDigits);

	const sign = scaledAmount < 0n ? "-" : "";
	const absolute = scaledAmount < 0n ? -scaledAmount : scaledAmount;
	const integer = absolute / outputScale;
	const fraction = absolute % outputScale;

	if (fractionDigits === 0) {
		return `${sign}$${integer.toString()}`;
	}

	return `${sign}$${integer.toString()}.${fraction.toString().padStart(fractionDigits, "0")}`;
}

export function formatUsdFromRawAmount(
	rawAmount: bigint,
	decimals: number,
	priceUsd: number,
	fractionDigits = 2
): string {
	return formatScaledUsd(
		usdScaledFromRawAmount(rawAmount, decimals, priceUsd, fractionDigits),
		fractionDigits
	);
}
