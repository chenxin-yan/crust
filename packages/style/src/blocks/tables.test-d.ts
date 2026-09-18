// Compile-time contracts, enforced by check:types (not bun test).

import { type ColumnAlignment, table } from "./tables.ts";

// `table` only reads its inputs, so predeclared readonly data (e.g. `as const`
// command metadata) must be accepted without copies or casts.
{
	const headers = ["Name", "Age"] as const;
	const rows = [
		["Alice", "30"],
		["Bob", "25"],
	] as const;
	const align: readonly ColumnAlignment[] = ["left", "right"];

	const _readonlyInputs: string = table(headers, rows, { align });

	// Mutable inputs remain accepted.
	const _mutableInputs: string = table(["Name"], [["Alice"]], { align: ["left"] });
}
