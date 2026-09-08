# @crustjs/compiler

Private M0 TypeScript-to-Go compiler. `compile(entryFile)` is the public test seam;
corpus tests compile and execute binaries against Node, not emitted-source snapshots.
The only package dependency is TypeScript. The checker loads compiler-owned ES2022
and M0 console/process declarations, independent of the caller's working directory;
Node, Bun, and DOM ambient types are not discovered. `process.exit` requires a
number argument. Invalid exit calls (including `process.exit()`), `console.error`,
and `console.warn` are rejected by the checker before lowering (`CRUST1000`).

## String representation boundary

Missing string-array entries remain JavaScript `undefined`, including through string
parameters and returns. Reading their length raises a `TypeError`.

TypeScript can label `process.argv[99] + 1` as a string even though JavaScript
produces `NaN`. Direct logging and template interpolation preserve that runtime
addition. Such additions cannot cross function argument or return boundaries unless
a literal/template string operand guarantees concatenation (including nested
concatenation). Otherwise `compile()` rejects them before Go emission; this keeps
numeric values out of string slots without making every number dynamically typed.
Use a template or an explicit `"" + value` to guarantee a string at that boundary.
Non-null assertions do not establish that guarantee.

## Runtime error contract

Corpus stdout and exit status are compared exactly with the actual Node oracle.
Successful stderr is also byte-identical. For supported runtime exceptions, native
stderr is one newline-terminated error line: exact class, optional Node error code,
and full message, including the received value. This is **not** byte parity with
Node's entire diagnostic output.

The harness removes only Node's recognized diagnostic envelope: source/internal
path and line, source excerpt and caret, stack frames, duplicate `code` property
(which must match the error header), and Node version footer. Unrecognized stderr
fails the test; messages and received-value context are never shortened or ignored.
The native runtime does not reproduce Node stacks or machine-specific paths.

Covered exceptions are undefined `.length` (`TypeError`) and invalid numeric
`process.exit` codes (`RangeError [ERR_OUT_OF_RANGE]`), including the distinction
between non-integers and integers outside the safe range. Reference validation uses
Node 26.8.1; changes to Node's diagnostic format must be reviewed explicitly.

## Diagnostics

TypeScript validation and lowering failures throw `CompilerError`. Its `diagnostics` array contains a stable code, source file, one-based line and column, message, and rewrite hint.

M0 rejects TypeScript suppression directives before type analysis or lowering: leading single-line `@ts-nocheck` pragmas and `@ts-ignore` / `@ts-expect-error` comment directives recognized by TypeScript 5.9. Remove the directive and fix the hidden TypeScript errors. Directive-like text inside strings, templates, regular expressions, or ordinary comments is not a suppression directive.

User-written `any` annotations, implicit `any` reported by TypeScript, and calls returning the intrinsic `any` type (such as `JSON.parse`) are rejected in the entry source. Library declarations themselves are not rejected. TypeScript recovery types are not misreported as user `any`, and inferred `never` remains an unsupported type rather than an `any` error.

Unsupported type-valid calls name the operation. Operations with no supported replacement, such as `Math.abs`, must be removed rather than merely renamed. Direct string-array logging is deferred; use template string coercion instead.

| Code        | Meaning                        | Rewrite                                                                                                                                              |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRUST1000` | Invalid TypeScript             | Fix the reported TypeScript error before compiling.                                                                                                  |
| `CRUST1001` | Unsupported `any` type         | Rewrite the `any`-typed construct using supported M0 expressions or typed function parameters. Remove calls such as `JSON.parse` that produce `any`. |
| `CRUST1002` | Unsupported language construct | Follow the operation-specific hint when available; otherwise remove or rewrite the construct using the supported M0 language surface.                |
| `CRUST1003` | Unsupported type suppression   | Remove the named TypeScript suppression directive and fix the errors it hides before compiling.                                                      |
