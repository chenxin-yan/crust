import type { Expression, FunctionDeclaration, Program, Statement, ValueType } from "./ir.js";

export const runtimeModule = "github.com/chenxin-yan/crust/packages/compiler/runtime";

export function emitGo(program: Program): string {
	const functions = program.functions.map(emitFunction).join("\n\n");
	const statements = program.statements.map((statement) => emitStatement(statement, 1)).join("\n");

	return `package main

import crustRuntime ${JSON.stringify(runtimeModule)}
${functions ? `\n${functions}\n` : ""}
func main() {
${statements}
}
`;
}

function emitFunction(declaration: FunctionDeclaration): string {
	const parameters = declaration.parameters
		.map((parameter) => `${parameter.name} ${emitType(parameter.type)}`)
		.join(", ");
	const returnType =
		declaration.returnType === "void" ? "" : ` ${emitType(declaration.returnType)}`;
	const statements = declaration.statements
		.map((statement) => emitStatement(statement, 1))
		.join("\n");
	return `func ${declaration.name}(${parameters})${returnType} {\n${statements}\n}`;
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
			return emitNumber(expression.value as number);
		case "identifier":
			return expression.name;
		case "binary": {
			const left = emitExpression(expression.left);
			const right = emitExpression(expression.right);
			if (expression.type === "string") {
				return `(crustRuntime.String(${left}) + crustRuntime.String(${right}))`;
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
			if (expression.callee === "process.exit") {
				return `crustRuntime.Exit(${emitExpression(expression.arguments[0]!)})`;
			}
			return `${expression.callee}(${expression.arguments.map(emitExpression).join(", ")})`;
		case "argv":
			return "crustRuntime.Argv()";
		case "slice":
			return `${emitExpression(expression.value)}[int(${emitExpression(expression.start)}):]`;
		case "length":
			return `float64(len(${emitExpression(expression.value)}))`;
		case "index":
			return `${emitExpression(expression.value)}[int(${emitExpression(expression.index)})]`;
	}
}

function emitType(type: ValueType): string {
	switch (type) {
		case "boolean":
			return "bool";
		case "number":
			return "float64";
		case "string":
			return "string";
		case "string-array":
			return "[]string";
		case "void":
			return "";
	}
}

function emitNumber(value: number): string {
	return Number.isInteger(value) ? `${value}.0` : String(value);
}

function goString(value: string): string {
	return JSON.stringify(
		Array.from(value, (character) =>
			character.length === 1 && /[\uD800-\uDFFF]/.test(character) ? "\uFFFD" : character,
		).join(""),
	).replaceAll("\uFEFF", "\\ufeff");
}
