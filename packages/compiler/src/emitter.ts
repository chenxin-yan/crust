import type { Expression, FunctionDeclaration, Program, Statement, ValueType } from "./ir.js";

export const runtimeModule = "github.com/chenxin-yan/crust/packages/compiler/runtime";

export function emitGo(program: Program): string {
	const functions = program.functions.map(emitFunction).join("\n\n");
	const statements = program.statements.map((statement) => emitStatement(statement, 1)).join("\n");

	return `package main

import crustRuntime ${JSON.stringify(runtimeModule)}

// Keep the runtime import valid for programs with no runtime operations.
var _ = crustRuntime.Number
${functions ? `\n${functions}\n` : ""}
func main() {
${statements}
}
`;
}

function emitFunction(declaration: FunctionDeclaration): string {
	const parameters = declaration.parameters
		.map((parameter) => `${goIdentifier(parameter.name)} ${emitType(parameter.type)}`)
		.join(", ");
	const returnType =
		declaration.returnType === "void" ? "" : ` ${emitType(declaration.returnType)}`;
	const statements = declaration.statements
		.map((statement) => emitStatement(statement, 1))
		.join("\n");
	return `func ${goIdentifier(declaration.name)}(${parameters})${returnType} {\n${statements}\n}`;
}

function emitStatement(statement: Statement, indentation: number): string {
	const indent = "\t".repeat(indentation);
	switch (statement.kind) {
		case "log":
			return `${indent}crustRuntime.Log(${statement.values.map(emitExpression).join(", ")})`;
		case "expression":
			return `${indent}${emitExpression(statement.expression)}`;
		case "return":
			return statement.expression
				? `${indent}return ${emitExpression(statement.expression)}`
				: `${indent}return`;
	}
}

function emitExpression(expression: Expression): string {
	switch (expression.kind) {
		case "literal":
			if (expression.type === "string") return goString(expression.value);
			if (expression.type === "boolean") return String(expression.value);
			return emitNumber(expression.value);
		case "identifier":
			return goIdentifier(expression.name);
		case "binary": {
			const left = emitExpression(expression.left);
			const right = emitExpression(expression.right);
			if (expression.type === "string") {
				return `crustRuntime.Add(${left}, ${right})`;
			}
			if (expression.operator === "%") return `crustRuntime.Mod(${left}, ${right})`;
			return `(${left} ${expression.operator} ${right})`;
		}
		case "unary":
			return `(${expression.operator}${emitExpression(expression.operand)})`;
		case "template":
			return expression.spans.reduce(
				(result, span) =>
					`${result} + crustRuntime.String(${emitExpression(span.expression)}) + ${goString(span.literal)}`,
				goString(expression.head),
			);
		case "call":
			return `${goIdentifier(expression.callee)}(${expression.arguments.map(emitExpression).join(", ")})`;
		case "exit":
			return `crustRuntime.Exit(${emitExpression(expression.code)})`;
		case "argv":
			return `crustRuntime.Argv(${goString(expression.entryFile)})`;
		case "slice":
			return `crustRuntime.Slice(${emitExpression(expression.value)}, ${emitExpression(expression.start)})`;
		case "length":
			return `crustRuntime.Length(${emitExpression(expression.value)})`;
		case "index":
			return `crustRuntime.Index(${emitExpression(expression.value)}, ${emitExpression(expression.index)})`;
	}
}

function goIdentifier(name: string): string {
	return `js_${name.replace(/[^a-zA-Z0-9]/gu, (character) =>
		character === "_" ? "__" : `_u${character.codePointAt(0)!.toString(16)}_`,
	)}`;
}

function emitType(type: ValueType): string {
	switch (type) {
		case "boolean":
			return "bool";
		case "number":
			return "float64";
		case "string":
			// Array indexing can yield undefined despite TypeScript's string type.
			return "any";
		case "string-array":
			return "[]string";
		case "void":
			return "";
	}
}

function emitNumber(value: number): string {
	if (!Number.isFinite(value)) {
		return value < 0 ? "-crustRuntime.Infinity()" : "crustRuntime.Infinity()";
	}
	// A call prevents Go constant folding from changing IEEE-754 arithmetic.
	const literal = String(value);
	return `crustRuntime.Number(${Number.isInteger(value) && !literal.includes("e") ? `${literal}.0` : literal})`;
}

function goString(value: string): string {
	return JSON.stringify(
		Array.from(value, (character) =>
			character.length === 1 && /[\uD800-\uDFFF]/.test(character) ? "\uFFFD" : character,
		).join(""),
	).replaceAll("\uFEFF", "\\ufeff");
}
