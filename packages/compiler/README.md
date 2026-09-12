# @crustjs/compiler

Private M0 TypeScript-to-Go compiler. `compile(entryFile)` is the public test seam;
corpus tests compile and execute binaries against Node, not emitted-source snapshots.
The only package dependency is TypeScript. The checker loads compiler-owned ES2022
and M0 console/process declarations, independent of the caller's working directory;
Node, Bun, and DOM ambient types are not discovered. `process.exit` requires a
number argument. Invalid exit calls (including `process.exit()`), `console.error`,
and `console.warn` are rejected by the checker before lowering (`CRUST1000`).

## M0 boundary

M0 covers literals, arithmetic/string expressions, templates, function declarations and calls, `console.log`, `process.argv`, and `process.exit`. It is not a general TypeScript or Node implementation. Direct array logging is deferred; array-to-string coercion in templates remains supported. Actual TypeScript suppression directives (`@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck`) are rejected before lowering; remove the directive and fix the type error. Merely mentioning directive text in a string is not a suppression.

## Testing

Use the repository Bun version from the root `package.json` `packageManager` field. Compiler-only checks:

```sh
cd packages/compiler
bun run build
bun run check:types
bun run test
```

`test` runs Go-free diagnostics and public `compile()` regressions. Test observable behavior through `compile()`, not internal lowering functions, IR snapshots, or emitted Go snapshots.

For native differential tests, install the optional Go toolchain pinned in the root `mise.toml` (`mise install go`) and put it and Node **24** on `PATH`:

```sh
# From packages/compiler
bun run test:corpus

# Or from the repository root
bun turbo run test:corpus --filter=@crustjs/compiler
```

The corpus task is uncached and separate from framework tests. Missing Go produces an explicit warning and skips native cases; that is not a native parity pass. Compiler CI installs Node 24, reads Bun from `packageManager`, and verifies the exact pinned Go version before running the corpus. Compiler build, types, lint, formatting, and Go-free tests still run in the framework lane.

`process.argv[0]` represents the native executable rather than Node, so executable-path behavior has a dedicated assertion. Number formatting is fuzzed with a deterministic seed; set `CRUST_NUMBER_FUZZ_SEED` to replay another seed.

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
between non-integers and integers outside the safe range. CI uses Node 24; local validation also ran Node 26.8.1; changes to Node's diagnostic format must be reviewed explicitly.

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
