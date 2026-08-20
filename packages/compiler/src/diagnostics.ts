import type ts from "typescript";

export const DiagnosticCodes = {
	TypeScriptError: "CRUST1000",
	AnyType: "CRUST1001",
	UnsupportedConstruct: "CRUST1002",
} as const;

export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];

export interface CompilerDiagnostic {
	readonly code: DiagnosticCode;
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
	readonly hint: string;
}

function formatDiagnostic(diagnostic: CompilerDiagnostic): string {
	return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}\n  hint: ${diagnostic.hint}`;
}

export class CompilerError extends Error {
	public constructor(public readonly diagnostics: readonly CompilerDiagnostic[]) {
		super(diagnostics.map(formatDiagnostic).join("\n"));
		this.name = "CompilerError";
	}
}

export function diagnosticAtNode(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	code: DiagnosticCode,
	message: string,
	hint: string,
): CompilerDiagnostic {
	const { character, line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	return {
		code,
		file: sourceFile.fileName,
		line: line + 1,
		column: character + 1,
		message,
		hint,
	};
}
