// The public surface: the types `.each()` and the overrides name, and not the operation model or
// the problem list, which `crust build` reports.
import type { Operation, OperationOverride } from "./index.ts";
// @ts-expect-error -- `operations()` is internal
import { operations } from "./index.ts";
// @ts-expect-error -- a parameter is `Operation["params"][number]`
import type { Param } from "./index.ts";
// @ts-expect-error -- problems are `crust build`'s output, not a public list
import type { Diagnostic } from "./index.ts";
import { defineApi } from "./index.ts";

// Compile-time regression checks; intentionally never invoked.
function _typecheckPublicTypes(op: Operation, override: OperationOverride) {
	const method: "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace" =
		op.method;
	const location: Operation["params"][number]["in"] = op.params[0]!.in;
	type _Param = Param;
	type _Diagnostic = Diagnostic;
	const acme = defineApi({ spec: { openapi: "3.1.0", paths: {} }, baseUrl: "https://a.test" });
	// @ts-expect-error -- `crust build` checks the handle
	void acme.lint;
	// @ts-expect-error -- the CLI's surface is `app.snapshot()`
	void acme.manifest;
	void [method, location, override, operations];
}
void _typecheckPublicTypes;
