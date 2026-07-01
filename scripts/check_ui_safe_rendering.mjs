import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const uiRoot = fileURLToPath(new URL("../frontend/src/components/ui", import.meta.url));
// Nama sink dirangkai agar script guard ini tidak dianggap sebagai pemanggilan aplikasi.
const unsafeReactHtmlProp = ["dangerously", "Set", "Inner", "HTML"].join("");
const unsafeReactHtmlPayload = ["__", "html"].join("");
const unsafeElementHtmlProperty = ["inner", "HTML"].join("");
const forbiddenTokens = [unsafeReactHtmlProp, unsafeReactHtmlPayload, unsafeElementHtmlProperty];
const dangerousObjectProperties = new Set([unsafeReactHtmlProp, unsafeReactHtmlPayload]);
const violations = [];

function collectTsxFiles(directory) {
	const entries = readdirSync(directory).sort();
	const files = [];

	for (const entry of entries) {
		const path = join(directory, entry);
		const stats = statSync(path);

		if (stats.isDirectory()) {
			files.push(...collectTsxFiles(path));
		} else if (entry.endsWith(".tsx")) {
			files.push(path);
		}
	}

	return files;
}

function getPropertyName(name) {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}

	return undefined;
}

function addViolation(sourceFile, filePath, node, message) {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	violations.push({
		filePath,
		line: position.line + 1,
		column: position.character + 1,
		message,
	});
}

function visit(sourceFile, filePath, node) {
	if (ts.isJsxAttribute(node) && node.name.text === unsafeReactHtmlProp) {
		addViolation(sourceFile, filePath, node, "JSX attribute raw HTML tidak diperbolehkan.");
	}

	if (ts.isPropertyAssignment(node)) {
		const propertyName = getPropertyName(node.name);
		if (propertyName && dangerousObjectProperties.has(propertyName)) {
			addViolation(
				sourceFile,
				filePath,
				node,
				`Object property ${propertyName} tidak boleh dipakai di komponen UI.`,
			);
		}
	}

	if (ts.isShorthandPropertyAssignment(node) && dangerousObjectProperties.has(node.name.text)) {
		addViolation(
			sourceFile,
			filePath,
			node,
			`Object shorthand ${node.name.text} tidak boleh dipakai di komponen UI.`,
		);
	}

	if (ts.isPropertyAccessExpression(node) && node.name.text === unsafeElementHtmlProperty) {
		addViolation(sourceFile, filePath, node, "Akses raw HTML property tidak diperbolehkan di komponen UI.");
	}

	if (
		ts.isElementAccessExpression(node) &&
		ts.isStringLiteral(node.argumentExpression) &&
		node.argumentExpression.text === unsafeElementHtmlProperty
	) {
		addViolation(sourceFile, filePath, node, "Akses raw HTML property tidak diperbolehkan di komponen UI.");
	}

	ts.forEachChild(node, (child) => visit(sourceFile, filePath, child));
}

for (const filePath of collectTsxFiles(uiRoot)) {
	const source = readFileSync(filePath, "utf8");
	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);

	for (const token of forbiddenTokens) {
		const index = source.indexOf(token);
		if (index !== -1) {
			const position = sourceFile.getLineAndCharacterOfPosition(index);
			violations.push({
				filePath,
				line: position.line + 1,
				column: position.character + 1,
				message: `Token ${token} tidak boleh muncul di komponen UI.`,
			});
		}
	}

	visit(sourceFile, filePath, sourceFile);
}

if (violations.length > 0) {
	console.error("Komponen UI wajib merender React nodes, bukan HTML mentah.\n");

	for (const violation of violations) {
		console.error(
			`${relative(process.cwd(), violation.filePath)}:${violation.line}:${violation.column} ${violation.message}`,
		);
	}

	process.exit(1);
}

console.log("Komponen UI aman dari sink HTML mentah.");
