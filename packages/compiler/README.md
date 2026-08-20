# @crustjs/compiler

Experimental TypeScript-to-Go compiler for Crust command-line programs.

## Diagnostics

Compilation failures throw `CompilerError`. Its `diagnostics` array contains a stable code, source file, one-based line and column, message, and rewrite hint.

| Code        | Meaning                        | Rewrite                                                                                                                                                              |
| ----------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRUST1000` | Invalid TypeScript             | Fix the reported TypeScript error before compiling.                                                                                                                  |
| `CRUST1001` | Unsupported `any` type         | Replace `any` with `unknown`, then narrow it with a runtime check. Calls such as `JSON.parse` that return `any` must likewise be assigned to `unknown` and narrowed. |
| `CRUST1002` | Unsupported language construct | Use the diagnostic's construct-specific rewrite hint.                                                                                                                |
