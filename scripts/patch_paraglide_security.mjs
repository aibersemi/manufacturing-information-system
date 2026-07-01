import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

class ParaglideSecurityPatchError extends Error {}

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PARAGLIDE_ROOT = path.resolve(REPO_ROOT, "frontend", "src", "paraglide");
const RUNTIME_FILE = path.resolve(PARAGLIDE_ROOT, "runtime.js");
const SERVER_FILES = [path.resolve(PARAGLIDE_ROOT, "server.js"), path.resolve(PARAGLIDE_ROOT, "server.d.ts")];

const UNSAFE_RUNTIME_ACCESS = ["const value = values", "[name];"].join("");
const SAFE_RUNTIME_ACCESS = "const value = getOwnDataProperty(values, name);";
const FILL_PATTERN_MARKER = "function fillPattern(pattern, values, origin) {";
const TREE_SHAKE_MARKER = "const TREE_SHAKE_LOCAL_STORAGE_STRATEGY_USED = false;";
const TRUSTED_URL_GUARD_MARKER = "function isTrustedLocalizedUrl(url) {";
const OWN_DATA_PROPERTY_HELPER = `function getOwnDataProperty(record, key) {
    if ((typeof record !== "object" && typeof record !== "function") || record === null) {
        return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor && "value" in descriptor) {
        return descriptor.value;
    }
    return undefined;
}
`;
const TRUSTED_URL_GUARD = `
const LOCAL_DEVELOPMENT_URL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function getTrustedLocalizedUrlOrigins() {
    const configuredOrigins = [
        import.meta.env?.VITE_PUBLIC_FRONTEND_URL,
        globalThis.location?.origin,
    ];
    const origins = new Set();
    for (const configuredOrigin of configuredOrigins) {
        if (!configuredOrigin) {
            continue;
        }
        try {
            origins.add(new URL(configuredOrigin).origin);
        } catch {
            // Abaikan konfigurasi origin yang tidak valid.
        }
    }
    return origins;
}

function isTrustedLocalizedUrl(url) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        return false;
    }
    if (getTrustedLocalizedUrlOrigins().has(url.origin)) {
        return true;
    }
    return import.meta.env?.DEV === true && LOCAL_DEVELOPMENT_URL_HOSTNAMES.has(url.hostname);
}

function assertTrustedLocalizedUrl(url) {
    if (isTrustedLocalizedUrl(url)) {
        return url;
    }
    throw new Error(\`Lokalisasi URL ditolak untuk origin tidak tepercaya: \${url.origin}\`);
}

function toTrustedLocalizedUrl(url) {
    const urlObject = typeof url === "string" ? new URL(url, getUrlOrigin()) : new URL(url.href);
    return assertTrustedLocalizedUrl(urlObject);
}
`;
const TRUSTED_URL_REPLACEMENTS = [
	{
		label: "localizeUrl default pattern",
		unsafe: `    if (TREE_SHAKE_DEFAULT_URL_PATTERN_USED) {
        return localizeUrlDefaultPattern(url, targetLocale);
    }
    const urlObj = typeof url === "string" ? new URL(url) : url;`,
		safe: `    if (TREE_SHAKE_DEFAULT_URL_PATTERN_USED) {
        return assertTrustedLocalizedUrl(localizeUrlDefaultPattern(url, targetLocale));
    }
    const urlObj = toTrustedLocalizedUrl(url);`,
	},
	{
		label: "localizeUrl localized match return",
		unsafe: "            return fillMissingUrlParts(localizedUrl, match);",
		safe: "            return assertTrustedLocalizedUrl(fillMissingUrlParts(localizedUrl, match));",
	},
	{
		label: "localizeUrl unlocalized match return",
		unsafe: "                return fillMissingUrlParts(localizedUrl, unlocalizedMatch);",
		safe: "                return assertTrustedLocalizedUrl(fillMissingUrlParts(localizedUrl, unlocalizedMatch));",
	},
	{
		label: "localizeUrl original return",
		unsafe: `    // If no match found, return the original URL
    return urlObj;
}`,
		safe: `    // If no match found, return the original URL
    return assertTrustedLocalizedUrl(urlObj);
}`,
	},
	{
		label: "localizeUrlDefaultPattern input",
		unsafe: `function localizeUrlDefaultPattern(url, locale) {
    const urlObj = typeof url === "string" ? new URL(url, getUrlOrigin()) : new URL(url);
    const currentLocale = extractLocaleFromUrl(urlObj);`,
		safe: `function localizeUrlDefaultPattern(url, locale) {
    const urlObj = toTrustedLocalizedUrl(url);
    const currentLocale = extractLocaleFromUrl(urlObj);`,
	},
	{
		label: "localizeUrlDefaultPattern return",
		unsafe: `    return urlObj;
}
/**
 * Low-level URL de-localization function`,
		safe: `    return assertTrustedLocalizedUrl(urlObj);
}
/**
 * Low-level URL de-localization function`,
	},
	{
		label: "deLocalizeUrl default pattern",
		unsafe: `    if (TREE_SHAKE_DEFAULT_URL_PATTERN_USED) {
        return deLocalizeUrlDefaultPattern(url);
    }
    const urlObj = typeof url === "string" ? new URL(url) : url;`,
		safe: `    if (TREE_SHAKE_DEFAULT_URL_PATTERN_USED) {
        return assertTrustedLocalizedUrl(deLocalizeUrlDefaultPattern(url));
    }
    const urlObj = toTrustedLocalizedUrl(url);`,
	},
	{
		label: "deLocalizeUrl localized match return",
		unsafe: "                return fillMissingUrlParts(baseUrl, match);",
		safe: "                return assertTrustedLocalizedUrl(fillMissingUrlParts(baseUrl, match));",
	},
	{
		label: "deLocalizeUrl unlocalized match return",
		unsafe: "            return fillMissingUrlParts(baseUrl, unlocalizedMatch);",
		safe: "            return assertTrustedLocalizedUrl(fillMissingUrlParts(baseUrl, unlocalizedMatch));",
	},
	{
		label: "deLocalizeUrl original return",
		unsafe: `    // no match found return the original url
    return urlObj;
}`,
		safe: `    // no match found return the original url
    return assertTrustedLocalizedUrl(urlObj);
}`,
	},
	{
		label: "deLocalizeUrlDefaultPattern input",
		unsafe: `function deLocalizeUrlDefaultPattern(url) {
    const urlObj = typeof url === "string" ? new URL(url, getUrlOrigin()) : new URL(url);
    const pathSegments = urlObj.pathname.split("/").filter(Boolean);`,
		safe: `function deLocalizeUrlDefaultPattern(url) {
    const urlObj = toTrustedLocalizedUrl(url);
    const pathSegments = urlObj.pathname.split("/").filter(Boolean);`,
	},
	{
		label: "deLocalizeUrlDefaultPattern return",
		unsafe: `    return urlObj;
}
/**
 * Takes matches of implicit wildcards`,
		safe: `    return assertTrustedLocalizedUrl(urlObj);
}
/**
 * Takes matches of implicit wildcards`,
	},
];

function assertPathInside(baseDirectory, targetPath) {
	const normalizedBase = path.normalize(baseDirectory);
	const normalizedTarget = path.normalize(targetPath);
	const relativePath = path.relative(normalizedBase, normalizedTarget);

	if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
		return normalizedTarget;
	}

	throw new ParaglideSecurityPatchError(`Path keluar dari root Paraglide: ${targetPath}`);
}

function replaceRuntimeSnippet(source, replacement) {
	if (source.includes(replacement.safe)) {
		return { changed: false, content: source };
	}
	if (!source.includes(replacement.unsafe)) {
		throw new ParaglideSecurityPatchError(`Marker patch Paraglide tidak ditemukan: ${replacement.label}.`);
	}
	return {
		changed: true,
		content: source.replace(replacement.unsafe, replacement.safe),
	};
}

export function patchRuntimeContent(source) {
	let patched = source;
	let changed = false;

	if (patched.includes(UNSAFE_RUNTIME_ACCESS)) {
		if (!patched.includes("function getOwnDataProperty(record, key) {")) {
			if (!patched.includes(FILL_PATTERN_MARKER)) {
				throw new ParaglideSecurityPatchError("Marker fillPattern tidak ditemukan di runtime Paraglide.");
			}
			patched = patched.replace(FILL_PATTERN_MARKER, `${OWN_DATA_PROPERTY_HELPER}\n${FILL_PATTERN_MARKER}`);
		}
		patched = patched.replace(UNSAFE_RUNTIME_ACCESS, SAFE_RUNTIME_ACCESS);
		changed = true;
	}

	if (!patched.includes(TRUSTED_URL_GUARD_MARKER)) {
		if (!patched.includes(TREE_SHAKE_MARKER)) {
			throw new ParaglideSecurityPatchError("Marker tree-shake Paraglide tidak ditemukan di runtime.");
		}
		patched = patched.replace(TREE_SHAKE_MARKER, `${TREE_SHAKE_MARKER}\n${TRUSTED_URL_GUARD}`);
		changed = true;
	}

	for (const replacement of TRUSTED_URL_REPLACEMENTS) {
		const result = replaceRuntimeSnippet(patched, replacement);
		patched = result.content;
		changed = changed || result.changed;
	}

	if (!patched.includes(SAFE_RUNTIME_ACCESS)) {
		throw new ParaglideSecurityPatchError("Patch own-data-property Paraglide tidak terpasang.");
	}
	if (!patched.includes(TRUSTED_URL_GUARD_MARKER)) {
		throw new ParaglideSecurityPatchError("Patch trusted-origin Paraglide tidak terpasang.");
	}
	for (const replacement of TRUSTED_URL_REPLACEMENTS) {
		if (!patched.includes(replacement.safe)) {
			throw new ParaglideSecurityPatchError(`Patch trusted-origin Paraglide tidak lengkap: ${replacement.label}.`);
		}
	}

	return { changed, content: patched };
}

function patchRuntimeFile({ check }) {
	const runtimeFile = assertPathInside(PARAGLIDE_ROOT, RUNTIME_FILE);
	const source = ts.sys.readFile(runtimeFile, "utf8");
	if (source === undefined) {
		throw new ParaglideSecurityPatchError(`Runtime Paraglide tidak dapat dibaca: ${runtimeFile}`);
	}
	const result = patchRuntimeContent(source);

	if (result.changed) {
		if (check) {
			throw new ParaglideSecurityPatchError(`${runtimeFile} belum memakai patch own-data-property.`);
		}
		ts.sys.writeFile(runtimeFile, result.content);
	}

	return result.changed ? [runtimeFile] : [];
}

function removeServerFiles({ check }) {
	const changedFiles = [];

	for (const serverFile of SERVER_FILES) {
		const safeServerFile = assertPathInside(PARAGLIDE_ROOT, serverFile);
		if (!ts.sys.fileExists(safeServerFile)) {
			continue;
		}
		if (check) {
			throw new ParaglideSecurityPatchError(`${safeServerFile} masih ada, padahal SPA tidak memakai middleware SSR.`);
		}
		ts.sys.deleteFile(safeServerFile);
		changedFiles.push(safeServerFile);
	}

	return changedFiles;
}

export function patchParaglideSecurity(options = {}) {
	const check = options.check === true;

	return [...patchRuntimeFile({ check }), ...removeServerFiles({ check })];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const changedFiles = patchParaglideSecurity({ check: process.argv.includes("--check") });
		if (changedFiles.length > 0) {
			console.log(`Patch keamanan Paraglide diterapkan:\n${changedFiles.join("\n")}`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
