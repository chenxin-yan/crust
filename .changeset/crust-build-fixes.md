---
"@crustjs/crust": patch
---

`crust build` fixes:

- A failed build keeps the previous `.crust/`: the build is staged in a temporary folder and replaces `.crust/` only when it succeeds.
- In a runtime package with `crust.external`, a module loaded with `await import()` keeps its external imports to itself. The bundle is split at each `import()` into `bin/chunk-*.js`, so a command that never loads the module starts without the external installed, instead of failing with `ERR_MODULE_NOT_FOUND`.
- `--artifact package` ignores `crust.targets`, and `--artifact binary` ignores `crust.external`, instead of failing when they override `crust.artifact`.
- Node binary builds no longer print `Unknown section name for note 'UNKNOWN'`.
