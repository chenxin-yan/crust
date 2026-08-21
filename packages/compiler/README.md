# @crustjs/compiler

Experimental TypeScript-to-Go compiler for Crust command-line programs.

## Diagnostics

TypeScript validation and lowering failures throw `CompilerError`. Its `diagnostics` array contains a stable code, source file, one-based line and column, message, and rewrite hint.

| Code        | Meaning                        | Rewrite                                                                                                                                              |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRUST1000` | Invalid TypeScript             | Fix the reported TypeScript error before compiling.                                                                                                  |
| `CRUST1001` | Unsupported `any` type         | Rewrite the `any`-typed construct using supported M0 expressions or typed function parameters. Remove calls such as `JSON.parse` that produce `any`. |
| `CRUST1002` | Unsupported language construct | Rewrite the program using the supported M0 language surface named by the diagnostic.                                                                 |
