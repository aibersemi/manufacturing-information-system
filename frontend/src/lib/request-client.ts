type RequestClientConfig = RequestInit & {
	params?: Record<string, unknown>;
	data?: unknown;
};

type ErrorResponse = {
	detail?: string;
	message?: string;
	[key: string]: unknown;
};

const JSON_CONTENT_TYPE = "application/json";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
const MAX_JSON_PAYLOAD_BYTES = 1_048_576;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RETRYABLE_SAFE_STATUS = new Set([408, 502, 503, 504]);

let rateLimitedUntil = 0;

export class ApiError extends Error {
	status: number;
	data: ErrorResponse;
	headers?: Headers;

	constructor(status: number, message: string, data: ErrorResponse = {}, headers?: Headers) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.data = data;
		this.headers = headers;
	}
}

function getCookie(name: string) {
	if (typeof document === "undefined") return undefined;

	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) return parts.pop()?.split(";").shift();
}

function createRequestId() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getBaseUrl() {
	const fallbackOrigin =
		typeof window !== "undefined" ? window.location.origin : "http://localhost";
	return import.meta.env.VITE_API_BASE_URL || fallbackOrigin;
}

function ensureApiPath(urlPath: string) {
	if (urlPath.startsWith("/api/") || urlPath === "/api") return urlPath;
	if (urlPath.startsWith("/")) return `/api${urlPath}`;
	return `/api/${urlPath}`;
}

function isPrimitiveParam(value: unknown): value is string | number | boolean {
	return ["string", "number", "boolean"].includes(typeof value);
}

function appendQueryParams(url: URL, params?: Record<string, unknown>) {
	if (!params) return;

	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;

		const values = Array.isArray(value) ? value : [value];
		for (const item of values) {
			if (!isPrimitiveParam(item)) {
				throw new ApiError(400, "Parameter request tidak valid.", {
					detail: "Parameter request tidak valid.",
				});
			}
			url.searchParams.append(key, String(item));
		}
	}
}

function buildUrl(urlPath: string, params?: Record<string, unknown>) {
	const baseUrl = new URL(getBaseUrl());
	const url = new URL(ensureApiPath(urlPath), baseUrl);
	const allowedOrigins = new Set([baseUrl.origin]);

	if (typeof window !== "undefined") {
		allowedOrigins.add(window.location.origin);
	}
	if (!["http:", "https:"].includes(url.protocol) || !allowedOrigins.has(url.origin)) {
		throw new ApiError(400, "Origin API tidak diizinkan.", {
			detail: "Origin API tidak diizinkan.",
		});
	}

	appendQueryParams(url, params);
	return url.toString();
}

function getBodySize(body: BodyInit) {
	if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
	if (body instanceof Blob) return body.size;
	if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).byteLength;
	return undefined;
}

function buildBody(body: BodyInit | null | undefined, data: unknown): BodyInit | undefined {
	if (body !== undefined && body !== null) {
		return body;
	}
	if (data === undefined) {
		return undefined;
	}
	return JSON.stringify(data);
}

function validatePayloadSize(body: BodyInit | undefined) {
	if (!body) return;

	const size = getBodySize(body);
	if (size !== undefined && size > MAX_JSON_PAYLOAD_BYTES) {
		throw new ApiError(413, "Payload terlalu besar.", {
			detail: "Payload terlalu besar.",
		});
	}
}

function normalizeContentType(headers: Headers, body: BodyInit | undefined) {
	if (!body || body instanceof FormData) return;

	if (!headers.has("Content-Type")) {
		headers.set("Content-Type", JSON_CONTENT_TYPE);
	}

	const contentType = headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
	const allowedContentTypes = new Set([
		JSON_CONTENT_TYPE,
		"application/x-www-form-urlencoded",
		"multipart/form-data",
	]);
	if (contentType && !allowedContentTypes.has(contentType)) {
		throw new ApiError(415, "Content-Type tidak diizinkan.", {
			detail: "Content-Type tidak diizinkan.",
		});
	}
}

function mergeSignals(signals: Array<AbortSignal | null | undefined>) {
	const activeSignals = signals.filter(Boolean) as AbortSignal[];
	if (activeSignals.length === 0) return undefined;
	if (activeSignals.length === 1) return activeSignals[0];

	const controller = new AbortController();
	for (const signal of activeSignals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), {
			once: true,
		});
	}
	return controller.signal;
}

function getRetryAfterMs(headers: Headers) {
	const retryAfter = headers.get("Retry-After");
	if (!retryAfter) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;

	const seconds = Number(retryAfter);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}

	const retryDate = Date.parse(retryAfter);
	if (Number.isFinite(retryDate)) {
		return Math.max(0, retryDate - Date.now());
	}
	return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

async function parseErrorResponse(response: Response): Promise<ErrorResponse> {
	try {
		return (await response.json()) as ErrorResponse;
	} catch {
		return { detail: response.statusText };
	}
}

function getErrorMessage(status: number, data: ErrorResponse) {
	if (status >= 500) return "Terjadi gangguan pada server.";
	return data.detail || data.message || "Request gagal.";
}

function redirectToLogin(status: number, urlPath: string) {
	if (status !== 401 || typeof window === "undefined") return;
	if (
		window.location.pathname === "/login" ||
		urlPath === "/api/auth/login" ||
		urlPath === "/api/auth/tenants"
	) {
		return;
	}
	window.location.assign("/login");
}

function ensureRateLimitWindow() {
	const waitMs = rateLimitedUntil - Date.now();
	if (waitMs <= 0) return;

	throw new ApiError(429, "Terlalu banyak request. Coba lagi nanti.", {
		detail: "Terlalu banyak request. Coba lagi nanti.",
		retry_after_ms: waitMs,
	});
}

function delay(ms: number, signal?: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const timeout = globalThis.setTimeout(resolve, ms);
		if (!signal) return;

		signal.addEventListener(
			"abort",
			() => {
				globalThis.clearTimeout(timeout);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
	const timeoutController = new AbortController();
	const timeoutId = globalThis.setTimeout(() => timeoutController.abort(), timeoutMs);
	const signal = mergeSignals([init.signal, timeoutController.signal]);

	try {
		return await fetch(url, { ...init, signal });
	} catch (error) {
		if (timeoutController.signal.aborted) {
			throw new ApiError(408, "Request timeout.", { detail: "Request timeout." });
		}
		if (error instanceof ApiError) throw error;
		throw new ApiError(0, "Koneksi API gagal.", { detail: "Koneksi API gagal." });
	} finally {
		globalThis.clearTimeout(timeoutId);
	}
}

async function performRequest(url: string, init: RequestInit, method: string) {
	const maxAttempts = method === "GET" ? 2 : 1;
	let attempt = 0;

	while (attempt < maxAttempts) {
		const response = await fetchWithTimeout(url, init);
		if (!RETRYABLE_SAFE_STATUS.has(response.status) || attempt + 1 >= maxAttempts) {
			return response;
		}

		attempt += 1;
		await delay(250 * 2 ** (attempt - 1), init.signal ?? undefined);
	}

	throw new ApiError(0, "Koneksi API gagal.", { detail: "Koneksi API gagal." });
}

export const requestClient = async <T>(
	urlPath: string,
	config: RequestClientConfig,
): Promise<T> => {
	ensureRateLimitWindow();

	const { data, params, headers: configHeaders, signal, body: configBody, ...requestInit } = config;
	const method = (config.method || "GET").toUpperCase();
	const body = buildBody(configBody, data);
	validatePayloadSize(body);

	const headers = new Headers(configHeaders);
	normalizeContentType(headers, body);
	if (!headers.has("X-Request-ID")) {
		headers.set("X-Request-ID", createRequestId());
	}

	const csrfToken = getCookie("csrftoken");
	if (csrfToken && MUTATION_METHODS.has(method)) {
		headers.set("X-CSRFToken", csrfToken);
	}

	const url = buildUrl(urlPath, params);
	const response = await performRequest(
		url,
		{
			...requestInit,
			body,
			credentials: "include",
			headers,
			method,
			referrerPolicy: "strict-origin-when-cross-origin",
			signal,
		},
		method,
	);

	if (response.status === 429) {
		rateLimitedUntil = Date.now() + getRetryAfterMs(response.headers);
	}

	if (!response.ok) {
		const errorData = await parseErrorResponse(response);
		redirectToLogin(response.status, urlPath);
		throw new ApiError(
			response.status,
			getErrorMessage(response.status, errorData),
			errorData,
			response.headers,
		);
	}

	if (response.status === 204) {
		return { data: {}, status: response.status, headers: response.headers } as T;
	}

	let responseData: unknown = {};
	try {
		responseData = await response.json();
	} catch {
		// Endpoint tertentu valid mengembalikan body kosong.
	}

	return { data: responseData, status: response.status, headers: response.headers } as T;
};
