/** The deliberately small boundary between TypeScript analysis and Go emission. */
export interface Program {
	readonly functions: readonly FunctionDeclaration[];
	readonly statements: readonly Statement[];
}

export type ValueType = "boolean" | "number" | "string" | "string-array" | "void";

export interface FunctionDeclaration {
	readonly name: string;
	readonly parameters: readonly Parameter[];
	readonly returnType: ValueType;
	readonly statements: readonly Statement[];
}

export interface Parameter {
	readonly name: string;
	readonly type: ValueType;
}

export type Expression =
	| {
			readonly kind: "literal";
			readonly type: Exclude<ValueType, "string-array" | "void">;
			readonly value: boolean | number | string;
	  }
	| { readonly kind: "identifier"; readonly name: string }
	| {
			readonly kind: "binary";
			readonly left: Expression;
			readonly operator: "+" | "-" | "*" | "/" | "%";
			readonly right: Expression;
			readonly type: ValueType;
	  }
	| { readonly kind: "unary"; readonly operator: "+" | "-"; readonly operand: Expression }
	| { readonly kind: "template"; readonly head: string; readonly spans: readonly TemplateSpan[] }
	| { readonly kind: "call"; readonly callee: string; readonly arguments: readonly Expression[] }
	| { readonly kind: "argv" }
	| { readonly kind: "slice"; readonly value: Expression; readonly start: Expression }
	| { readonly kind: "length"; readonly value: Expression }
	| { readonly kind: "index"; readonly value: Expression; readonly index: Expression };

export interface TemplateSpan {
	readonly expression: Expression;
	readonly literal: string;
}

export type Statement =
	| { readonly kind: "log"; readonly values: readonly Expression[] }
	| { readonly kind: "expression"; readonly expression: Expression }
	| { readonly kind: "return"; readonly expression?: Expression };
