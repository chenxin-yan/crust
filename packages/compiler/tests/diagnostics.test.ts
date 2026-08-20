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
		expect(error.diagnostics[0]?.hint).toContain("Replace the `any` value");
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
		expect(error.diagnostics[0]?.hint).toContain("Replace the `any` value");
		expectLocated(error);
	});

	it("reports unsupported constructs with a rewrite hint", async () => {
		const error = await compileFailure("unsupported.ts");
		expect(error.diagnostics[0]?.code).toBe(DiagnosticCodes.UnsupportedConstruct);
		expect(error.diagnostics[0]?.hint).toContain("Rewrite the program");
		expectLocated(error);
	});
});
