const INDONESIAN_LOCALE = "id-ID";
const JAKARTA_TIME_ZONE = "Asia/Jakarta";

function formatNumberId(value: number | string, options?: Intl.NumberFormatOptions) {
	return new Intl.NumberFormat(INDONESIAN_LOCALE, options).format(Number(value));
}

function formatCurrency(value: number | string) {
	return new Intl.NumberFormat(INDONESIAN_LOCALE, {
		style: "currency",
		currency: "IDR",
		maximumFractionDigits: 2,
	}).format(Number(value));
}

function formatDateTime(value: string | number | Date) {
	return new Intl.DateTimeFormat(INDONESIAN_LOCALE, {
		dateStyle: "medium",
		timeStyle: "medium",
		timeZone: JAKARTA_TIME_ZONE,
	}).format(new Date(value));
}

function normalizeIndonesianNumber(value: string) {
	return value.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
}

function parseDecimalId(value: string) {
	return Number.parseFloat(normalizeIndonesianNumber(value));
}

function parseIntegerId(value: string) {
	return Number.parseInt(normalizeIndonesianNumber(value), 10);
}

export { formatCurrency, formatDateTime, formatNumberId, parseDecimalId, parseIntegerId };
