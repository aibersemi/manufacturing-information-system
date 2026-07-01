import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const frontendPackageJson = JSON.parse(
	await readFile(new URL("../frontend/package.json", import.meta.url), "utf8"),
);
const declaredDependencies = {
	...packageJson.dependencies,
	...packageJson.devDependencies,
};

const requiredTanStackPackages = new Set([
	"@tanstack/react-form",
	"@tanstack/react-query",
	"@tanstack/react-ranger",
	"@tanstack/react-router",
	"@tanstack/react-store",
	"@tanstack/react-table",
	"@tanstack/react-virtual",
]);

const alternativePackages = new Set([
	"@apollo/client",
	"@reduxjs/toolkit",
	"ag-grid-react",
	"final-form",
	"formik",
	"jotai",
	"mobx",
	"mobx-react-lite",
	"rc-slider",
	"react-final-form",
	"react-hook-form",
	"react-range",
	"react-router",
	"react-router-dom",
	"react-table",
	"react-virtualized",
	"react-window",
	"recoil",
	"redux",
	"swr",
	"wouter",
	"zustand",
]);

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const importPattern = /(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g;
const frontendSourceDirectory = fileURLToPath(new URL("../frontend/src", import.meta.url));
const frontendRoutesDirectory = join(frontendSourceDirectory, "routes");
const shadcnUiDirectory = join(frontendSourceDirectory, "components", "ui");
const generatedApiDirectory = join(frontendSourceDirectory, "api", "generated");
const generatedParaglideDirectory = join(frontendSourceDirectory, "paraglide");
const paraglideServerImportPattern = /(?:^|\/)paraglide\/server(?:\.js)?$/;
const forbiddenParaglideServerImports = [];
const dropdownMenuWrapperFile = join(shadcnUiDirectory, "dropdown-menu.tsx");
const forbiddenDropdownMenuImports = [];
const dataTableWrapperFile = join(frontendSourceDirectory, "components", "data-table.tsx");
const directTableImports = [];
const rawUiElementPattern =
	/<\s*(a|button|input|select|textarea|label|table|thead|tbody|tfoot|tr|th|td|dialog|hr|details|summary)\b|role\s*=\s*["'](button|menu|menubar|menuitem|menuitemcheckbox|menuitemradio)["']/g;
const rawUiViolations = [];
const shadcnPrimitivePackages = new Set([
	"class-variance-authority",
	"cmdk",
	"next-themes",
	"react-day-picker",
	"recharts",
	"vaul",
]);
const directPrimitiveImports = [];
const routeStatePattern =
	/import\s*{\s*[^}]*\buse(?:State|Reducer)\b[^}]*}\s*from\s*["']react["']|React\.use(?:State|Reducer)\s*\(/;
const routeStateViolations = [];
const routeFormViolations = [];

function getPackageName(importSource) {
	const [scopeOrName, packageName] = importSource.split("/");
	return scopeOrName.startsWith("@") ? `${scopeOrName}/${packageName}` : scopeOrName;
}

async function findUnsupportedImports(directory) {
	const unsupportedImports = [];
	const entries = await readdir(directory, { withFileTypes: true });

	for (const entry of entries) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			unsupportedImports.push(...(await findUnsupportedImports(entryPath)));
			continue;
		}
		if (!sourceExtensions.has(extname(entry.name))) {
			continue;
		}

		const source = await readFile(entryPath, "utf8");
		const isShadcnUiFile = entryPath.startsWith(`${shadcnUiDirectory}/`);
		const isGeneratedApiFile = entryPath.startsWith(`${generatedApiDirectory}/`);
		const isGeneratedParaglideFile = entryPath.startsWith(`${generatedParaglideDirectory}/`);
		const isRouteFile = entryPath.startsWith(`${frontendRoutesDirectory}/`);
		if (!isShadcnUiFile && !isGeneratedApiFile && !isGeneratedParaglideFile) {
			for (const match of source.matchAll(rawUiElementPattern)) {
				rawUiViolations.push(
					`${relative(process.cwd(), entryPath)}: gunakan komponen shadcn/ui untuk ${match[0]}`,
				);
			}
		}
		if (isRouteFile && routeStatePattern.test(source)) {
			routeStateViolations.push(
				`${relative(process.cwd(), entryPath)}: state route wajib memakai TanStack sesuai fungsi (Form/Store/Router/Query), bukan React useState/useReducer`,
			);
		}
		if (
			isRouteFile &&
			/<form\b/.test(source) &&
			!/from\s*["']@tanstack\/react-form["']/.test(source)
		) {
			routeFormViolations.push(
				`${relative(process.cwd(), entryPath)}: form route wajib dikelola dengan TanStack Form`,
			);
		}

		for (const match of source.matchAll(importPattern)) {
			const packageName = getPackageName(match[1]);
			if (
				!isShadcnUiFile &&
				(packageName.startsWith("@radix-ui/") || shadcnPrimitivePackages.has(packageName))
			) {
				directPrimitiveImports.push(`${relative(process.cwd(), entryPath)}: ${packageName}`);
			}
			if (!isGeneratedParaglideFile && paraglideServerImportPattern.test(match[1])) {
				forbiddenParaglideServerImports.push(`${entryPath}: ${match[1]}`);
			}
			if (match[1] === "@radix-ui/react-dropdown-menu" && entryPath !== dropdownMenuWrapperFile) {
				forbiddenDropdownMenuImports.push(`${relative(process.cwd(), entryPath)}: ${match[1]}`);
			}
			if (match[1] === "@/components/ui/table" && entryPath !== dataTableWrapperFile) {
				directTableImports.push(`${relative(process.cwd(), entryPath)}: ${match[1]}`);
			}

			if (
				(packageName.startsWith("@tanstack/") && !requiredTanStackPackages.has(packageName)) ||
				alternativePackages.has(packageName)
			) {
				unsupportedImports.push(`${entryPath}: ${packageName}`);
			}
		}
	}

	return unsupportedImports;
}

const missingPackages = [...requiredTanStackPackages].filter(
	(packageName) => !(packageName in declaredDependencies),
);
const unsupportedTanStackPackages = Object.keys(declaredDependencies).filter(
	(packageName) => packageName.startsWith("@tanstack/") && !requiredTanStackPackages.has(packageName),
);
const frontendDeclaredPackages = [
	...Object.keys(frontendPackageJson.dependencies ?? {}),
	...Object.keys(frontendPackageJson.devDependencies ?? {}),
];
const installedAlternatives = Object.keys(declaredDependencies).filter((packageName) =>
	alternativePackages.has(packageName),
);
const unsupportedImports = await findUnsupportedImports(frontendSourceDirectory);

const errors = [];
if (missingPackages.length > 0) {
	errors.push(`Paket TanStack wajib belum tersedia: ${missingPackages.join(", ")}`);
}
if (unsupportedTanStackPackages.length > 0) {
	errors.push(
		`Paket TanStack di luar kebijakan terdeteksi: ${unsupportedTanStackPackages.join(", ")}`,
	);
}
if (frontendDeclaredPackages.length > 0) {
	errors.push(
		`Dependency frontend wajib didaftarkan di package.json root, bukan frontend/package.json: ${frontendDeclaredPackages.join(", ")}`,
	);
}
if (installedAlternatives.length > 0) {
	errors.push(
		`Library alternatif untuk manajemen aplikasi terdeteksi: ${installedAlternatives.join(", ")}`,
	);
}
if (unsupportedImports.length > 0) {
	errors.push(`Import di luar kebijakan terdeteksi:\n${unsupportedImports.join("\n")}`);
}
if (rawUiViolations.length > 0) {
	errors.push(
		`Elemen UI mentah di luar src/components/ui dilarang. Tambahkan komponen dengan "npx shadcn@latest add <komponen> -c frontend" dari root repo, lalu impor dari "@/components/ui/*":\n${rawUiViolations.join("\n")}`,
	);
}
if (directPrimitiveImports.length > 0) {
	errors.push(
		`Primitive UI pihak ketiga hanya boleh dipakai di wrapper shadcn/ui dalam "frontend/src/components/ui":\n${directPrimitiveImports.join("\n")}`,
	);
}
if (forbiddenParaglideServerImports.length > 0) {
	errors.push(
		`Import middleware server Paraglide dilarang pada SPA frontend:\n${forbiddenParaglideServerImports.join("\n")}`,
	);
}
if (forbiddenDropdownMenuImports.length > 0) {
	errors.push(
		`Dropdown menu wajib memakai wrapper shadcn/ui dari "@/components/ui/dropdown-menu". Jangan impor primitive Radix langsung di luar wrapper tersebut:\n${forbiddenDropdownMenuImports.join("\n")}`,
	);
}
if (directTableImports.length > 0) {
	errors.push(
		`Tabel data wajib melalui wrapper "@/components/data-table" berbasis TanStack Table. Jangan impor "@/components/ui/table" langsung di luar wrapper:\n${directTableImports.join("\n")}`,
	);
}
if (routeStateViolations.length > 0) {
	errors.push(
		`State pada route frontend wajib memakai keluarga TanStack sesuai fungsi:\n${routeStateViolations.join("\n")}`,
	);
}
if (routeFormViolations.length > 0) {
	errors.push(`Form pada route frontend wajib memakai TanStack Form:\n${routeFormViolations.join("\n")}`);
}

if (errors.length > 0) {
	console.error(errors.join("\n"));
	process.exitCode = 1;
} else {
	console.log("Kebijakan dependensi TanStack dan UI frontend valid.");
}
