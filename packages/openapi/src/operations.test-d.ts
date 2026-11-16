import { type Diagnostic, type Operation, type Param, operations } from "./index.ts";

// Compile-time regression checks; intentionally never invoked.
function _typecheckOperations() {
	const result: { operations: Operation[]; diagnostics: Diagnostic[] } = operations({ paths: {} });
	const [op] = result.operations;
	if (op === undefined) return;

	const method: "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace" =
		op.method;
	const location: "path" | "query" | "header" | "cookie" = (op.params[0] as Param).in;
	const level: "error" | "warning" = result.diagnostics[0]!.level;
	void [method, location, level];

	// @ts-expect-error the method is lowercase, as in the spec
	const upper: "GET" = op.method;
	// @ts-expect-error the model is read-only plain data
	op.params.push({ name: "x", in: "query", required: false });
	// @ts-expect-error an unknown diagnostic code
	const code: Diagnostic["code"] = "unknown-code";
	void [upper, code];
}
void _typecheckOperations;
