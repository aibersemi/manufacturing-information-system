import { parseDecimalId, parseIntegerId } from "@/lib/i18n";

function todayInputDate() {
	return new Date().toISOString().slice(0, 10);
}

function trimmedOptional(value: string) {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function splitIdList(value: string) {
	return value
		.split(/[\n,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function decimalInput(value: string) {
	return parseDecimalId(value);
}

function optionalDecimalInput(value: string) {
	const trimmed = value.trim();
	return trimmed.length > 0 ? parseDecimalId(trimmed) : undefined;
}

function integerInput(value: string) {
	return parseIntegerId(value);
}

function optionalIntegerInput(value: string) {
	const trimmed = value.trim();
	return trimmed.length > 0 ? parseIntegerId(trimmed) : undefined;
}

function newIdempotencyKey(prefix: string) {
	if (globalThis.crypto?.randomUUID) {
		return `${prefix}-${globalThis.crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseOptionalJsonObject(value: string) {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = JSON.parse(trimmed);
	if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
		throw new TypeError("JSON correction must be an object.");
	}
	return parsed as Record<string, unknown>;
}

function isOptionalJsonObject(value: string) {
	try {
		parseOptionalJsonObject(value);
		return true;
	} catch (_error) {
		return false;
	}
}

export {
	decimalInput,
	integerInput,
	isOptionalJsonObject,
	newIdempotencyKey,
	optionalDecimalInput,
	optionalIntegerInput,
	parseOptionalJsonObject,
	splitIdList,
	todayInputDate,
	trimmedOptional,
};
