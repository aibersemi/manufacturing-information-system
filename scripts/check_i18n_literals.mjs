import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";

const scanRoot = "frontend/src";
const excludedPathSegments = ["/api/generated/", "/paraglide/"];
const userFacingAttributes = new Set(["aria-label", "placeholder", "title", "alt", "description", "label"]);
const validationMethods = new Set(["min", "max", "length", "regex"]);
const toastMethods = new Set(["success", "error", "info", "warning"]);

async function listTsxFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				return listTsxFiles(path);
			}
			return path.endsWith(".tsx") ? [path] : [];
		}),
	);
	return files.flat();
}

function shouldScan(file) {
	const normalized = file.replaceAll("\\", "/");
	return !excludedPathSegments.some((segment) => normalized.includes(segment));
}

function hasLetter(value) {
	return /\p{L}/u.test(value);
}

function clean(value) {
	return value.replace(/\s+/g, " ").trim();
}

function lineNumber(sourceFile, node) {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function propertyName(node) {
	if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
		return node.text;
	}
	return undefined;
}

function userFacingString(value) {
	return hasLetter(value) ? clean(value) : "";
}

function collectJsxExpressionStrings(node, sourceFile, violations) {
	if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		const text = userFacingString(node.text);
		if (text) {
			violations.push({
				line: lineNumber(sourceFile, node),
				label: "string JSX langsung",
				text,
			});
		}
		return;
	}

	if (ts.isTemplateExpression(node)) {
		const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
			.map(userFacingString)
			.filter(Boolean);
		if (parts.length > 0) {
			violations.push({
				line: lineNumber(sourceFile, node),
				label: "template JSX langsung",
				text: parts.join(" / "),
			});
		}
		return;
	}

	if (ts.isConditionalExpression(node)) {
		collectJsxExpressionStrings(node.whenTrue, sourceFile, violations);
		collectJsxExpressionStrings(node.whenFalse, sourceFile, violations);
		return;
	}

	if (ts.isParenthesizedExpression(node)) {
		collectJsxExpressionStrings(node.expression, sourceFile, violations);
		return;
	}

	if (ts.isArrayLiteralExpression(node)) {
		for (const element of node.elements) {
			collectJsxExpressionStrings(element, sourceFile, violations);
		}
	}
}

function collectHeaderViolation(node, sourceFile, violations) {
	const initializer = node.initializer;
	if (ts.isStringLiteralLike(initializer)) {
		const text = userFacingString(initializer.text);
		if (text) {
			violations.push({
				line: lineNumber(sourceFile, node),
				label: "header tabel langsung",
				text,
			});
		}
		return;
	}

	if (ts.isArrowFunction(initializer) && initializer.body && ts.isStringLiteralLike(initializer.body)) {
		const text = userFacingString(initializer.body.text);
		if (text) {
			violations.push({
				line: lineNumber(sourceFile, initializer.body),
				label: "header tabel langsung",
				text,
			});
		}
	}
}

function collectValidationMessageViolation(node, sourceFile, violations) {
	const message = node.arguments[1];
	if (!message) {
		return;
	}

	if (ts.isStringLiteralLike(message)) {
		const text = userFacingString(message.text);
		if (text) {
			violations.push({
				line: lineNumber(sourceFile, message),
				label: "pesan validasi langsung",
				text,
			});
		}
		return;
	}

	if (ts.isObjectLiteralExpression(message)) {
		for (const property of message.properties) {
			if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== "message") {
				continue;
			}
			if (ts.isStringLiteralLike(property.initializer)) {
				const text = userFacingString(property.initializer.text);
				if (text) {
					violations.push({
						line: lineNumber(sourceFile, property.initializer),
						label: "pesan validasi langsung",
						text,
					});
				}
			}
		}
	}
}

function collectViolations(sourceFile) {
	const violations = [];

	function visit(node) {
		if (ts.isJsxText(node)) {
			const text = userFacingString(node.getText(sourceFile));
			if (text) {
				violations.push({
					line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
					label: "teks JSX langsung",
					text,
				});
			}
		}

		if (ts.isJsxAttribute(node)) {
			const attributeName = node.name.text;
			if (
				userFacingAttributes.has(attributeName) &&
				node.initializer &&
				ts.isStringLiteral(node.initializer)
			) {
				const text = userFacingString(node.initializer.text);
				if (text) {
					violations.push({
						line: lineNumber(sourceFile, node),
						label: `prop ${attributeName} langsung`,
						text,
					});
				}
			}
		}

		if (
			ts.isJsxExpression(node) &&
			node.expression &&
			(ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
		) {
			collectJsxExpressionStrings(node.expression, sourceFile, violations);
		}

		if (ts.isPropertyAssignment(node) && propertyName(node.name) === "header") {
			collectHeaderViolation(node, sourceFile, violations);
		}

		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
			const method = node.expression.name.text;
			const target = ts.isIdentifier(node.expression.expression)
				? node.expression.expression.text
				: undefined;

			if (target === "toast" && toastMethods.has(method)) {
				const message = node.arguments[0];
				if (message && ts.isStringLiteralLike(message)) {
					const text = userFacingString(message.text);
					if (text) {
						violations.push({
							line: lineNumber(sourceFile, message),
							label: "toast langsung",
							text,
						});
					}
				}
			}

			if (validationMethods.has(method)) {
				collectValidationMessageViolation(node, sourceFile, violations);
			}
		}

		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return violations;
}

const violations = [];
const files = (await listTsxFiles(scanRoot)).filter(shouldScan);

for (const file of files) {
	const source = await readFile(file, "utf8");
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

	for (const violation of collectViolations(sourceFile)) {
		violations.push(
			`${relative(process.cwd(), file)}:${violation.line}: ${violation.label}: ${violation.text}`,
		);
	}
}

if (violations.length > 0) {
	console.error(
		[
			"Copy UI di file frontend TSX wajib memakai fungsi dari @/paraglide/messages.",
			"Tambahkan key ke frontend/messages/id.json, lalu pakai m.<key>().",
			"",
			...violations,
		].join("\n"),
	);
	process.exit(1);
}
