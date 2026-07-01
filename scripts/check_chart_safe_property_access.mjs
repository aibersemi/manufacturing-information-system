import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const targets = [
	fileURLToPath(new URL("../frontend/src/components/ui/chart.tsx", import.meta.url)),
	fileURLToPath(new URL("../frontend/src/routes/dashboard-home.tsx", import.meta.url)),
	fileURLToPath(new URL("../frontend/src/routes/reports.tsx", import.meta.url)),
];
const violations = [];

function addViolation(sourceFile, targetFile, node, message) {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	violations.push({
		filePath: targetFile,
		line: position.line + 1,
		column: position.character + 1,
		message,
	});
}

function visit(sourceFile, targetFile, node) {
	if (ts.isElementAccessExpression(node)) {
		addViolation(sourceFile, targetFile, node, "Akses object dengan bracket notation tidak diperbolehkan.");
	}

	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword) {
		addViolation(sourceFile, targetFile, node, "Operator in tidak boleh dipakai untuk lookup object.");
	}

	ts.forEachChild(node, (child) => visit(sourceFile, targetFile, child));
}

for (const targetFile of targets) {
	const source = readFileSync(targetFile, "utf8");
	const sourceFile = ts.createSourceFile(
		targetFile,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);

	visit(sourceFile, targetFile, sourceFile);
}

if (violations.length > 0) {
	console.error("File frontend wajib menghindari lookup object dengan key dinamis.\n");

	for (const violation of violations) {
		console.error(
			`${relative(process.cwd(), violation.filePath)}:${violation.line}:${violation.column} ${violation.message}`,
		);
	}

	process.exit(1);
}

console.log("File frontend aman dari bracket object notation runtime.");
