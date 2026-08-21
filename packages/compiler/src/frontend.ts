import { resolve } from "node:path";

import ts from "typescript";

import type { Expression, FunctionDeclaration, Program, Statement, ValueType } from "./ir.js";

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
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		noEmit: true,
		skipLibCheck: true,
		strict: true,
		target: ts.ScriptTarget.ES2022,
	};
	const program = ts.createProgram([absoluteEntry], compilerOptions);
	const diagnostics = ts.getPreEmitDiagnostics(program);
	if (diagnostics.length > 0) throw new TypeScriptCompileError(diagnostics);

	const sourceFile = program.getSourceFile(absoluteEntry);
	if (!sourceFile) throw new Error(`TypeScript did not load entry file: ${absoluteEntry}`);
	const checker = program.getTypeChecker();
	const functions: FunctionDeclaration[] = [];
	const statements: Statement[] = [];

	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement)) {
			functions.push(lowerFunction(statement, checker, sourceFile));
		} else {
			statements.push(lowerStatement(statement, checker, sourceFile));
		}
	}

	return { functions, statements };
}

function lowerFunction(
	node: ts.FunctionDeclaration,
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
): FunctionDeclaration {
	if (
		!node.name ||
		!node.body ||
		node.asteriskToken ||
		node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
	) {
		throw unsupported(node, sourceFile);
	}

	const signature = checker.getSignatureFromDeclaration(node);
	if (!signature) throw unsupported(node, sourceFile);

	return {
		name: node.name.text,
		parameters: node.parameters.map((parameter) => {
			const type = checker.getTypeAtLocation(parameter);
			if (
				!ts.isIdentifier(parameter.name) ||
				parameter.dotDotDotToken ||
				parameter.questionToken ||
				parameter.initializer ||
				Boolean(type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined))
			) {
				throw unsupported(parameter, sourceFile);
			}
			return {
				name: parameter.name.text,
				type: lowerType(type, parameter, sourceFile),
			};
		}),
		returnType: lowerType(checker.getReturnTypeOfSignature(signature), node, sourceFile),
		statements: node.body.statements.map((statement) =>
			lowerStatement(statement, checker, sourceFile),
		),
	};
}

function lowerStatement(
	node: ts.Statement,
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
): Statement {
	if (ts.isReturnStatement(node)) {
		if (
			node.expression &&
			Boolean(
				checker.getTypeAtLocation(node.expression).flags &
				(ts.TypeFlags.Never | ts.TypeFlags.Void | ts.TypeFlags.Undefined),
			)
		) {
			throw unsupported(node.expression, sourceFile);
		}
		return {
			kind: "return",
			expression: node.expression
				? lowerExpression(node.expression, checker, sourceFile)
				: undefined,
		};
	}
	if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) {
		throw unsupported(node, sourceFile);
	}

	const call = node.expression;
	if (isPropertyCall(call, "console", "log")) {
		const firstArgument = call.arguments[0];
		if (
			call.arguments.length === 0 ||
			(call.arguments.length > 1 &&
				firstArgument &&
				(ts.isStringLiteralLike(firstArgument)
					? /%[cdfijoOs%]/.test(firstArgument.text)
					: Boolean(
							checker.getTypeAtLocation(firstArgument).flags &
							(ts.TypeFlags.String | ts.TypeFlags.StringLiteral),
						))) ||
			call.arguments.some((argument) => {
				const type = checker.getTypeAtLocation(argument);
				return (
					checkerTypeIsStringArray(type) ||
					Boolean(type.flags & (ts.TypeFlags.Never | ts.TypeFlags.Void | ts.TypeFlags.Undefined))
				);
			})
		) {
			throw unsupported(call, sourceFile);
		}
		return {
			kind: "log",
			values: call.arguments.map((argument) => lowerExpression(argument, checker, sourceFile)),
		};
	}

	return { kind: "expression", expression: lowerExpression(call, checker, sourceFile) };
}

function lowerExpression(
	node: ts.Expression,
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
): Expression {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return { kind: "literal", type: "string", value: node.text };
	}
	if (ts.isNumericLiteral(node)) {
		return { kind: "literal", type: "number", value: Number(node.text) };
	}
	if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
		return { kind: "literal", type: "boolean", value: node.kind === ts.SyntaxKind.TrueKeyword };
	}
	if (ts.isIdentifier(node)) {
		const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
		if (!declaration || !ts.isParameter(declaration)) throw unsupported(node, sourceFile);
		return { kind: "identifier", name: node.text };
	}
	if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
		return lowerExpression(node.expression, checker, sourceFile);
	}
	if (ts.isPrefixUnaryExpression(node)) {
		const operator =
			node.operator === ts.SyntaxKind.PlusToken
				? "+"
				: node.operator === ts.SyntaxKind.MinusToken
					? "-"
					: undefined;
		if (
			!operator ||
			!(
				checker.getTypeAtLocation(node.operand).flags &
				(ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)
			)
		) {
			throw unsupported(node, sourceFile);
		}
		return {
			kind: "unary",
			operator,
			operand: lowerExpression(node.operand, checker, sourceFile),
		};
	}
	if (ts.isBinaryExpression(node)) {
		const operator = binaryOperator(node.operatorToken.kind);
		if (!operator) throw unsupported(node, sourceFile);
		return {
			kind: "binary",
			left: lowerExpression(node.left, checker, sourceFile),
			operator,
			right: lowerExpression(node.right, checker, sourceFile),
			type: lowerType(checker.getTypeAtLocation(node), node, sourceFile),
		};
	}
	if (ts.isTemplateExpression(node)) {
		return {
			kind: "template",
			head: node.head.text,
			spans: node.templateSpans.map((span) => {
				if (
					checker.getTypeAtLocation(span.expression).flags &
					(ts.TypeFlags.Void | ts.TypeFlags.Undefined)
				) {
					throw unsupported(span.expression, sourceFile);
				}
				return {
					expression: lowerExpression(span.expression, checker, sourceFile),
					literal: span.literal.text,
				};
			}),
		};
	}
	if (isProcessArgv(node)) return { kind: "argv", entryFile: sourceFile.fileName };
	if (ts.isPropertyAccessExpression(node) && node.name.text === "length") {
		let receiver: ts.Expression = node.expression;
		while (ts.isParenthesizedExpression(receiver) || ts.isNonNullExpression(receiver)) {
			receiver = receiver.expression;
		}
		const receiverType = checker.getTypeAtLocation(receiver);
		if (
			!(receiverType.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) &&
			!checkerTypeIsStringArray(receiverType)
		) {
			throw unsupported(node, sourceFile);
		}
		return {
			kind: "length",
			value: lowerExpression(receiver, checker, sourceFile),
		};
	}
	if (ts.isElementAccessExpression(node) && node.argumentExpression) {
		if (
			!checkerTypeIsStringArray(checker.getTypeAtLocation(node.expression)) ||
			!(
				checker.getTypeAtLocation(node.argumentExpression).flags &
				(ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)
			)
		) {
			throw unsupported(node, sourceFile);
		}
		return {
			kind: "index",
			value: lowerExpression(node.expression, checker, sourceFile),
			index: lowerExpression(node.argumentExpression, checker, sourceFile),
		};
	}
	if (ts.isCallExpression(node)) {
		if (
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "slice" &&
			node.arguments.length === 1 &&
			checkerTypeIsStringArray(checker.getTypeAtLocation(node.expression.expression))
		) {
			const start = node.arguments[0];
			if (!start) throw unsupported(node, sourceFile);
			return {
				kind: "slice",
				value: lowerExpression(node.expression.expression, checker, sourceFile),
				start: lowerExpression(start, checker, sourceFile),
			};
		}
		if (isPropertyCall(node, "process", "exit") && node.arguments.length === 1) {
			const argument = node.arguments[0];
			if (
				!argument ||
				!(
					checker.getTypeAtLocation(argument).flags &
					(ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)
				)
			) {
				throw unsupported(node, sourceFile);
			}
			return {
				kind: "call",
				callee: "process.exit",
				arguments: [lowerExpression(argument, checker, sourceFile)],
			};
		}
		if (ts.isIdentifier(node.expression)) {
			const declaration = checker.getSymbolAtLocation(node.expression)?.valueDeclaration;
			if (
				!declaration ||
				!ts.isFunctionDeclaration(declaration) ||
				declaration.getSourceFile() !== sourceFile
			) {
				throw unsupported(node, sourceFile);
			}
			return {
				kind: "call",
				callee: node.expression.text,
				arguments: node.arguments.map((argument) => lowerExpression(argument, checker, sourceFile)),
			};
		}
	}

	throw unsupported(node, sourceFile);
}

function lowerType(type: ts.Type, node: ts.Node, sourceFile: ts.SourceFile): ValueType {
	if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) return "string";
	if (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return "number";
	if (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return "boolean";
	if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return "void";
	if (checkerTypeIsStringArray(type)) return "string-array";
	throw unsupported(node, sourceFile);
}

function checkerTypeIsStringArray(type: ts.Type): boolean {
	return (
		type.getSymbol()?.getName() === "Array" &&
		type.getNumberIndexType()?.flags === ts.TypeFlags.String
	);
}

function binaryOperator(kind: ts.SyntaxKind): "+" | "-" | "*" | "/" | "%" | undefined {
	switch (kind) {
		case ts.SyntaxKind.PlusToken:
			return "+";
		case ts.SyntaxKind.MinusToken:
			return "-";
		case ts.SyntaxKind.AsteriskToken:
			return "*";
		case ts.SyntaxKind.SlashToken:
			return "/";
		case ts.SyntaxKind.PercentToken:
			return "%";
		default:
			return undefined;
	}
}

function isProcessArgv(node: ts.Expression): boolean {
	return (
		ts.isPropertyAccessExpression(node) &&
		ts.isIdentifier(node.expression) &&
		node.expression.text === "process" &&
		node.name.text === "argv"
	);
}

function isPropertyCall(node: ts.CallExpression, object: string, property: string): boolean {
	return (
		ts.isPropertyAccessExpression(node.expression) &&
		ts.isIdentifier(node.expression.expression) &&
		node.expression.expression.text === object &&
		node.expression.name.text === property
	);
}

function unsupported(node: ts.Node, sourceFile: ts.SourceFile): Error {
	const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	return new Error(
		`Unsupported TypeScript ${ts.SyntaxKind[node.kind]} at ${sourceFile.fileName}:${line + 1}:${character + 1}`,
	);
}
