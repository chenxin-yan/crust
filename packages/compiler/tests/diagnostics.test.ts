import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compile, CompilerError, DiagnosticCodes } from "../src/index.js";

async function compileFailure(fixtureName: string): Promise<CompilerError> {
	try {
		await compile(resolve(import.meta.dir, "fixtures", fixtureName));
		throw new Error(`Expected ${fixtureName} compilation to fail`);
	} catch (error) {
		expect(error).toBeInstanceOf(CompilerError);
		return error as CompilerError;
	}
}

async function compileSourceFailure(source: string): Promise<CompilerError> {
	const directory = await mkdtemp(join(tmpdir(), "crust-diagnostic-"));
	try {
		const entry = join(directory, "input.ts");
		await writeFile(entry, source);
		return await compileFailure(entry);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function expectLocated(error: CompilerError): void {
	for (const diagnostic of error.diagnostics) {
		expect(diagnostic.file).toEndWith(".ts");
		expect(diagnostic.line).toBeGreaterThan(0);
		expect(diagnostic.column).toBeGreaterThan(0);
		expect(error.message).toContain(
			`${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}]`,
		);
	}
}

describe("compiler diagnostic corpus", () => {
	it("rejects suppressed ill-typed calls before invoking Go", async () => {
		const error = await compileSourceFailure(
			'// @ts-nocheck\nfunction f(a: number): number { return a; }\nconsole.log(f("x"));',
		);
		expect(error.diagnostics).toHaveLength(1);
		expect(error.diagnostics[0]).toMatchObject({
			code: "CRUST1003",
			line: 1,
			column: 4,
			message: "TypeScript suppression directive @ts-nocheck is unsupported.",
			hint: "Remove @ts-nocheck and fix the TypeScript errors it suppresses before compiling.",
		});
		expectLocated(error);
	});

	it.each([
		{ comment: "// @ts-ignore", directive: "ts-ignore", line: 2, column: 4 },
		{
			comment: "/// @ts-expect-error: invalid argument",
			directive: "ts-expect-error",
			line: 2,
			column: 5,
		},
		{ comment: "/* @ts-ignore */", directive: "ts-ignore", line: 2, column: 4 },
		{
			comment: "/** explanation\n * @ts-expect-error */",
			directive: "ts-expect-error",
			line: 3,
			column: 4,
		},
		{ comment: "/* explanation\r\n @ts-ignore */", directive: "ts-ignore", line: 3, column: 2 },
		{ comment: "/* explanation\u2028 @ts-ignore */", directive: "ts-ignore", line: 3, column: 2 },
		{
			comment: "// @ts-ignore mentions @ts-ignore again",
			directive: "ts-ignore",
			line: 2,
			column: 4,
		},
	])(
		"rejects the directive in $comment at its source location",
		async ({ comment, directive, line, column }) => {
			const error = await compileSourceFailure(
				`function f(a: number): number { return a; }\n${comment}\nconsole.log(f("x"));`,
			);
			expect(error.diagnostics).toHaveLength(1);
			expect(error.diagnostics[0]).toMatchObject({
				code: DiagnosticCodes.TypeSuppression,
				line,
				column,
			});
			expect(error.diagnostics[0]?.hint).toContain(`Remove @${directive}`);
			expectLocated(error);
		},
	);

	it.each([
		"#!/usr/bin/env node\n// @TS-NOCHECK: leading pragma\nconsole.log(1);",
		"/* header */\n/// @ts-nocheck\nconsole.log(1);",
		"function f(a: number): number { return /* @ts-ignore */ a; }",
		"console.log(`${/* @ts-ignore */ 1}`);",
		"console.log(1); // @ts-ignore",
	])("rejects actual directives in token trivia: %s", async (source) => {
		const error = await compileSourceFailure(source);
		expect(error.diagnostics.map(({ code }) => code)).toEqual([DiagnosticCodes.TypeSuppression]);
		expectLocated(error);
	});

	it.each([
		'console.log("// @ts-nocheck");',
		"console.log('// @ts-ignore');",
		"console.log(`// @ts-expect-error`);",
		"console.log(`${1}\n// @ts-ignore\n${`nested ${2}\n// @ts-nocheck`}`);",
		"console.log(/[//] @ts-ignore/);",
		"// Mention @ts-ignore without a directive",
		"/* @ts-nocheck */",
		"/* @ts-ignore\n */",
		"/**\n * @ts-expect-error\n */",
		"//// @ts-ignore",
		"// @ts-nochecked",
		'console.log("ok");\n// @ts-nocheck',
	])("does not treat ordinary text as a suppression: %s", async (text) => {
		const error = await compileSourceFailure(
			`${text}\nfunction f(a: number): number { return a; }\nconsole.log(f("x"));`,
		);
		expect(error.diagnostics.map(({ code }) => code)).toEqual([DiagnosticCodes.TypeScriptError]);
		expect(error.diagnostics[0]?.message).toContain("TS2345");
		expectLocated(error);
	});

	it("converts TypeScript failures to coded diagnostics", async () => {
		const error = await compileFailure("typescript-error.ts");
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.TypeScriptError);
		expect(error.diagnostics[0]?.hint).toContain("Fix the TypeScript error");
		expectLocated(error);
	});

	it("rejects user-written any annotations with a rewrite hint", async () => {
		const error = await compileFailure("any-annotation.ts");
		expect(error.diagnostics.map(({ code }) => code)).toContain(DiagnosticCodes.AnyType);
		expect(error.diagnostics[0]?.hint).toContain("Rewrite the `any`-typed construct");
		expectLocated(error);
	});

	it("rejects calls returning any at the call site", async () => {
		const error = await compileFailure("any-return.ts");
		const diagnostic = error.diagnostics.find(({ code }) => code === DiagnosticCodes.AnyType);
		expect(diagnostic?.message).toContain("This call returns `any`");
		expect(diagnostic?.hint).toContain("Remove the any-producing call");
		expectLocated(error);
	});

	it("does not report unresolved calls as returning any", async () => {
		const error = await compileFailure("unknown-call.ts");
		expect(error.diagnostics.map(({ code }) => code)).toEqual([DiagnosticCodes.TypeScriptError]);
		expectLocated(error);
	});

	it("converts noImplicitAny failures to the any diagnostic", async () => {
		const error = await compileFailure("implicit-any.ts");
		expect(error.diagnostics.every(({ code }) => code === DiagnosticCodes.AnyType)).toBeTrue();
		expect(error.diagnostics[0]?.hint).toContain("Rewrite the `any`-typed construct");
		expectLocated(error);
	});

	it("reports an implicit-any parameter once", async () => {
		const error = await compileFailure("implicit-any-parameter.ts");
		expect(error.diagnostics).toHaveLength(1);
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.AnyType);
		expectLocated(error);
	});

	it("does not classify recovery-any parameters as unsupported any", async () => {
		const error = await compileFailure("recovery-any-parameter.ts");
		expect(error.diagnostics.map(({ code }) => code)).toEqual([DiagnosticCodes.TypeScriptError]);
		expectLocated(error);
	});

	it("reports an implicit-any binding element once", async () => {
		const error = await compileFailure("implicit-any-binding.ts");
		expect(error.diagnostics.filter(({ code }) => code === DiagnosticCodes.AnyType)).toHaveLength(
			1,
		);
		expectLocated(error);
	});

	it("reports an annotated any parameter once", async () => {
		const error = await compileFailure("annotated-any-parameter.ts");
		expect(error.diagnostics.filter(({ code }) => code === DiagnosticCodes.AnyType)).toHaveLength(
			1,
		);
		expectLocated(error);
	});

	it("does not classify an inferred never self-call as any", async () => {
		const error = await compileSourceFailure("function recurse() { return recurse(); }");
		expect(error.diagnostics.map(({ code }) => code)).toEqual([
			DiagnosticCodes.UnsupportedConstruct,
		]);
		expectLocated(error);
	});

	it("does not classify inferred never returns as any", async () => {
		const error = await compileFailure("inferred-never.ts");
		expect(error.diagnostics.map(({ code }) => code)).not.toContain(DiagnosticCodes.AnyType);
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expectLocated(error);
	});

	it("does not infer circular any from a self-reference passed as an argument", async () => {
		const error = await compileFailure("inferred-never-self-argument.ts");
		expect(error.diagnostics.map(({ code }) => code)).not.toContain(DiagnosticCodes.AnyType);
		expectLocated(error);
	});

	it("does not infer circular any from unrelated recursion", async () => {
		const error = await compileFailure("inferred-never-unrelated-recursion.ts");
		expect(error.diagnostics.map(({ code }) => code)).not.toContain(DiagnosticCodes.AnyType);
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expectLocated(error);
	});

	it("names unsupported console.error and an honest stdout alternative", async () => {
		const error = await compileFailure("unsupported.ts");
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expect(error.diagnostics[0]?.message).toContain("console.error");
		expect(error.diagnostics[0]?.hint).toBe(
			"Use console.log(...) for stdout; stderr output is not supported in M0.",
		);
		expectLocated(error);
	});

	it.each([
		{
			call: 'console.warn("hello")',
			hint: "Use console.log(...) for stdout; stderr output is not supported in M0.",
		},
		{
			call: "console.log()",
			hint: "Use console.log with at least one supported value and no format placeholders.",
		},
		{ call: "process.exit()", hint: "Use process.exit(code) with one number argument." },
		{
			call: "console.log(`${process.argv.slice(1, 2)}`)",
			hint: "Use stringArray.slice(start) with one number argument; string slicing is not supported in M0.",
		},
	])("gives a supported call form for $call", async ({ call, hint }) => {
		const error = await compileSourceFailure(`${call};`);
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expect(error.diagnostics[0]?.hint).toBe(hint);
		expectLocated(error);
	});

	it("names unsupported built-ins without promising an unavailable rewrite", async () => {
		const error = await compileSourceFailure("console.log(Math.abs(-1));");
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expect(error.diagnostics[0]?.message).toContain("Math.abs");
		expect(error.diagnostics[0]?.hint).toBe(
			"Remove the Math.abs call; this operation is not supported in M0.",
		);
		expectLocated(error);
	});

	it("rejects unsuppressed inferred-any returns", async () => {
		const error = await compileSourceFailure("function recurse() { return recurse() + 1; }");
		expect(error.diagnostics.every(({ code }) => code === DiagnosticCodes.AnyType)).toBeTrue();
		expect(error.diagnostics[0]?.message).toContain("TS7023");
		expectLocated(error);
	});
});
