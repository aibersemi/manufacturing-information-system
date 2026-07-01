import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

class PathTraversalError extends Error {}

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROOT = resolveInsideRepo("frontend", "src");
const UI_COMPONENT_ROOT = resolveInsideRepo("frontend", "src", "components", "ui");
const GENERATED_API_ROOT = resolveInsideRepo("frontend", "src", "api", "generated");
const SOURCE_EXTENSIONS = new Set([".jsx", ".tsx"]);
const GIT_LIST_SOURCE_ARGS = [
	"ls-files",
	"-z",
	"--cached",
	"--others",
	"--exclude-standard",
	"--",
	"frontend/src",
];

function assertPathInside(baseDirectory, targetPath) {
	const normalizedBase = path.normalize(baseDirectory);
	const normalizedTarget = path.normalize(targetPath);
	const relativePath = path.relative(normalizedBase, normalizedTarget);

	if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
		return normalizedTarget;
	}

	throw new PathTraversalError(`Path keluar dari root yang diizinkan: ${targetPath}`);
}

function resolveInsideRepo(...segments) {
	return assertPathInside(REPO_ROOT, path.resolve(REPO_ROOT, ...segments));
}

function assertRepoRelativePath(repoRelativePath) {
	if (
		repoRelativePath === "" ||
		repoRelativePath === "." ||
		path.isAbsolute(repoRelativePath) ||
		repoRelativePath.includes(path.win32.sep)
	) {
		throw new PathTraversalError(`Path source tidak valid: ${repoRelativePath}`);
	}

	const normalizedPath = path.posix.normalize(repoRelativePath);

	if (normalizedPath === ".." || normalizedPath.startsWith("../")) {
		throw new PathTraversalError(`Path source keluar dari repositori: ${repoRelativePath}`);
	}

	return normalizedPath;
}

function resolveRepoListedSourceFile(repoRelativePath) {
	const safeRepoRelativePath = assertRepoRelativePath(repoRelativePath);
	return assertPathInside(ROOT, path.resolve(REPO_ROOT, safeRepoRelativePath));
}

function isPathInside(baseDirectory, targetPath) {
	try {
		assertPathInside(baseDirectory, targetPath);
		return true;
	} catch (error) {
		if (error instanceof PathTraversalError) {
			return false;
		}
		throw error;
	}
}

function assertRejectsPathTraversal(callback) {
	try {
		callback();
	} catch (error) {
		if (error instanceof PathTraversalError) {
			return;
		}
		throw error;
	}

	throw new Error("Validasi path traversal tidak menolak input berbahaya.");
}

function runPathSecuritySelfTest() {
	resolveRepoListedSourceFile("frontend/src/components/data-states.tsx");
	assertRejectsPathTraversal(() => resolveRepoListedSourceFile("../package.json"));
	assertRejectsPathTraversal(() => resolveRepoListedSourceFile("/etc/passwd"));
	assertRejectsPathTraversal(() => resolveRepoListedSourceFile("frontend/src/../package.json"));
	assertRejectsPathTraversal(() => assertPathInside(ROOT, path.resolve(ROOT, "..", "package.json")));
}

function listSourceFiles() {
	const output = execFileSync("git", GIT_LIST_SOURCE_ARGS, {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 20 * 1024 * 1024,
	});

	return output
		.split("\0")
		.filter(Boolean)
		.map(resolveRepoListedSourceFile)
		.filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath)))
		.filter((filePath) => ts.sys.fileExists(filePath))
		.filter((filePath) => !isPathInside(GENERATED_API_ROOT, filePath));
}

function getIntrinsicTagName(node) {
	if (!ts.isIdentifier(node.tagName)) {
		return undefined;
	}

	const tagName = node.tagName.text;
	return /^[a-z]/.test(tagName) ? tagName : undefined;
}

function collectViolations(filePath) {
	const safeFilePath = assertPathInside(ROOT, path.resolve(filePath));
	const source = ts.sys.readFile(safeFilePath, "utf8");
	if (source === undefined) {
		throw new PathTraversalError(`File source tidak dapat dibaca: ${safeFilePath}`);
	}
	const sourceFile = ts.createSourceFile(safeFilePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const isUiComponentFile = isPathInside(UI_COMPONENT_ROOT, safeFilePath);
	const violations = [];

	function visit(node) {
		if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
			const tagName = getIntrinsicTagName(node);

			for (const attribute of node.attributes.properties) {
				if (ts.isJsxSpreadAttribute(attribute) && (tagName || isUiComponentFile)) {
					const position = sourceFile.getLineAndCharacterOfPosition(attribute.getStart(sourceFile));
					violations.push({
						filePath: safeFilePath,
						line: position.line + 1,
						column: position.character + 1,
						tagName: tagName ?? node.tagName.getText(sourceFile),
						expression: attribute.expression.getText(sourceFile),
						isUiComponentFile,
					});
				}
			}
		}

		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return violations;
}

runPathSecuritySelfTest();

const violations = listSourceFiles().flatMap(collectViolations);

if (violations.length > 0) {
	console.error("JSX spread props ke elemen DOM native dan wrapper UI tidak diperbolehkan.");
	console.error("Tulis atribut secara eksplisit agar prop tidak valid tidak ikut diteruskan.\n");

	for (const violation of violations) {
		console.error(
			`${violation.filePath}:${violation.line}:${violation.column} <${violation.tagName} {...${violation.expression}}>`,
		);
	}

	process.exit(1);
}
