import { readFile } from "node:fs/promises";
import { relative } from "node:path";

const cleanFiles = [
	"frontend/src/routes/finance/payment-requests.tsx",
	"frontend/src/routes/inventory/purchase-requests.tsx",
	"frontend/src/routes/masterdata/products.tsx",
];

function lineNumber(source, index) {
	return source.slice(0, index).split("\n").length;
}

const violations = [];

for (const file of cleanFiles) {
	const source = await readFile(file, "utf8");
	const label = relative(process.cwd(), file);

	if (!/from\s+["']zod["']/.test(source)) {
		violations.push(`${label}: import zod belum ada`);
	}

	if (!/\bz\.object\s*\(/.test(source)) {
		violations.push(`${label}: schema Zod belum dideklarasikan`);
	}

	if (!/validators\s*:\s*{[\s\S]*?onSubmit\s*:\s*\w+FormSchema/.test(source)) {
		violations.push(`${label}: TanStack Form belum memakai schema Zod pada onSubmit`);
	}

	if (!/function\s+to[A-Za-z0-9]+Payload\s*\([\s\S]*?value:\s*unknown/.test(source)) {
		violations.push(`${label}: transform payload belum mem-parse input unknown dengan Zod`);
	}

	for (const match of source.matchAll(/\b(?:mutate|mutateAsync)\s*\(\s*{[\s\S]*?\bdata\s*:\s*{/g)) {
		violations.push(
			`${label}:${lineNumber(source, match.index)}: payload mutasi dibuat inline; pakai fungsi to*Payload berbasis Zod`,
		);
	}
}

if (violations.length > 0) {
	console.error(
		[
			"Form mutasi di file Zod-clean wajib memakai boundary schema Zod sebelum mengirim payload API.",
			"Tambahkan schema, validators.onSubmit, dan fungsi to*Payload(value: unknown) yang mem-parse input dengan Zod.",
			"",
			...violations,
		].join("\n"),
	);
	process.exit(1);
}
