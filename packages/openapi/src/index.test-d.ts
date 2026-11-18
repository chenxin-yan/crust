// The public surface: the types `.each()`, `acme.lint()` and `acme.manifest()` name, and not the
// operation model, which those cover.
import type { Diagnostic, Operation } from "./index.ts";
// @ts-expect-error -- `operations()` is internal
import { operations } from "./index.ts";
// @ts-expect-error -- a parameter is `Operation["params"][number]`
import type { Param } from "./index.ts";

// Compile-time regression checks; intentionally never invoked.
function _typecheckPublicTypes(op: Operation, diagnostic: Diagnostic) {
	const method: "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace" =
		op.method;
	const level: "error" | "warning" = diagnostic.level;
	const location: Operation["params"][number]["in"] = op.params[0]!.in;
	type _Param = Param;
	void [method, level, location, operations];
}
void _typecheckPublicTypes;
