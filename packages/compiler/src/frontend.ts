import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import type { Program } from "./ir.js";

export class TypeScriptCompileError extends Error {
	public constructor(public readonly diagnostics: readonly ts.Diagnostic[]) {
		super(
			ts.formatDiagnosticsWithColorAndContext(diagnostics, {
				getCanonicalFileName: (fileName) => fileName,
				getCurrentDirectory: () => process.cwd(),
				getNewLine: () => "\n",
			}),
		);
		this.name = "TypeScriptCompileError";
	}
}

export function lower(entryFile: string): Program {
	const absoluteEntry = resolve(entryFile);
	const compilerOptions: ts.CompilerOptions = {
		lib: ["lib.es2022.d.ts"],
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		noEmit: true,
		skipLibCheck: true,
		strict: true,
		target: ts.ScriptTarget.ES2022,
		types: [],
	};
	// Runtime assets stay beside both src and dist; never discover the caller's host types.
	const ambientFile = fileURLToPath(new URL("../runtime/m0.d.ts", import.meta.url));
	const program = ts.createProgram([absoluteEntry, ambientFile], compilerOptions);
	const diagnostics = ts.getPreEmitDiagnostics(program);
	if (diagnostics.length > 0) throw new TypeScriptCompileError(diagnostics);

	const sourceFile = program.getSourceFile(absoluteEntry);
	if (!sourceFile) throw new Error(`TypeScript did not load entry file: ${absoluteEntry}`);
	const unsupportedStatement = 'The tracer compiler only supports one console.log("...") statement';
	if (sourceFile.statements.length !== 1) {
		throw new Error(unsupportedStatement);
	}

	const statement = sourceFile.statements[0];
	if (!statement || !ts.isExpressionStatement(statement)) {
		throw new Error(unsupportedStatement);
	}
	const call = statement.expression;
	if (
		!ts.isCallExpression(call) ||
		!ts.isPropertyAccessExpression(call.expression) ||
		call.expression.expression.getText(sourceFile) !== "console" ||
		call.expression.name.text !== "log" ||
		call.arguments.length !== 1
	) {
		throw new Error(unsupportedStatement);
	}

	const argument = call.arguments[0];
	if (!argument || !ts.isStringLiteral(argument)) {
		throw new Error("The tracer compiler only supports a string literal console.log argument");
	}

	return { statements: [{ kind: "log", value: argument.text }] };
}
