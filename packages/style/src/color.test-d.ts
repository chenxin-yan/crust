// Compile-time contracts, enforced by check:types (not vp test).

import type { ColorString } from "./types.ts";

// Syntax-hint literals and filled-in functional notation are assignable.
"rgb()" satisfies ColorString;
"rgb(0, 128, 255)" satisfies ColorString;
"#ff0000" satisfies ColorString;
// Dynamic strings still type-check via the open string fallback.
"dynamic" as string satisfies ColorString;
