import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { compile, CompilerError, DiagnosticCodes } from "../src/index.js";

async function compileFailure(fixtureName: string): Promise<CompilerError> {
	try {
		await compile(join(import.meta.dir, "fixtures", fixtureName));
		throw new Error(`Expected ${fixtureName} compilation to fail`);
	} catch (error) {
		expect(error).toBeInstanceOf(CompilerError);
		return error as CompilerError;
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

	it("classifies suppressed implicit-any parameters as unsupported any", async () => {
		const error = await compileFailure("suppressed-implicit-any.ts");
		expect(error.diagnostics.map(({ code }) => code)).toContain(DiagnosticCodes.AnyType);
		expectLocated(error);
	});

	it("classifies suppressed structured implicit-any parameters as unsupported any", async () => {
		const error = await compileFailure("suppressed-structured-any.ts");
		expect(error.diagnostics.map(({ code }) => code)).toContain(DiagnosticCodes.AnyType);
		expectLocated(error);
	});

	it("classifies suppressed implicit-any expressions as unsupported any", async () => {
		const error = await compileFailure("suppressed-this-any.ts");
		expect(error.diagnostics.map(({ code }) => code)).toContain(DiagnosticCodes.AnyType);
		expectLocated(error);
	});

	it("reports an annotated any parameter once", async () => {
		const error = await compileFailure("annotated-any-parameter.ts");
		expect(error.diagnostics.filter(({ code }) => code === DiagnosticCodes.AnyType)).toHaveLength(
			1,
		);
		expectLocated(error);
	});

	it("classifies suppressed inferred-any returns as unsupported any", async () => {
		const error = await compileFailure("suppressed-implicit-any-return.ts");
		expect(error.diagnostics.map(({ code }) => code)).toContain(DiagnosticCodes.AnyType);
		expectLocated(error);
	});

	it("does not classify inferred never returns as any", async () => {
		const error = await compileFailure("inferred-never.ts");
		expect(error.diagnostics.map(({ code }) => code)).not.toContain(DiagnosticCodes.AnyType);
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expectLocated(error);
	});

	it("does not infer circular any from unrelated recursion", async () => {
		const error = await compileFailure("inferred-never-unrelated-recursion.ts");
		expect(error.diagnostics.map(({ code }) => code)).not.toContain(DiagnosticCodes.AnyType);
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expectLocated(error);
	});

	it("reports unsupported constructs with a rewrite hint", async () => {
		const error = await compileFailure("unsupported.ts");
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expect(error.diagnostics[0]?.hint).toContain("Rewrite the CallExpression");
		expectLocated(error);
	});
});
