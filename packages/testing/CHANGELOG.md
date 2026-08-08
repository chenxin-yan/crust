# @crustjs/testing

## 0.1.0

### Minor Changes

- [#152](https://github.com/chenxin-yan/crust/pull/152) [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - New `captureExecute(app, argv)` in `@crustjs/testing` drives the terminal `execute()` path in-process: exit-code protocol (`0`/`1`/`130`), Extension `onError` rendering, and cancellation are assertable without subprocess probes; `process.exitCode` is restored afterwards. To support it, `Crust.execute()` now accepts an optional `io` override alongside `argv`.

- [#169](https://github.com/chenxin-yan/crust/pull/169) [`048edf2`](https://github.com/chenxin-yan/crust/commit/048edf27d71b05e89426010064bf7c5be37fc0c6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Consolidate public naming conventions:

  - `@crustjs/extensions`: Name the version extension options `VersionOptions` (matching `CompletionOptions`, `DidYouMeanOptions`, and `UpdateNotifierOptions`).
  - `@crustjs/skills`: Rename `skillStatus()` to `getSkillStatus()`; rename `GenerateOptions`/`GenerateResult` to `GenerateSkillOptions`/`GenerateSkillResult`, `UninstallOptions`/`UninstallResult` to `UninstallSkillOptions`/`UninstallSkillResult`, and `StatusOptions`/`StatusResult` to `SkillStatusOptions`/`SkillStatusResult` (domain-qualified, collision-safe names).
  - `@crustjs/testing`: Name the interactive runner `runInteractive()` (verb-first, consistent with `captureRun` and `captureExecute`).

- [#142](https://github.com/chenxin-yan/crust/pull/142) [`c679228`](https://github.com/chenxin-yan/crust/commit/c679228436d00a398c103142762ee89381e44836) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add application testing helpers with captured output and fake interactive terminals.

### Patch Changes

- [#144](https://github.com/chenxin-yan/crust/pull/144) [`4e4af76`](https://github.com/chenxin-yan/crust/commit/4e4af76a7236f64ee843504126d09efb799d54ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Export the structural `RunnableApp` contract and accept any application with its `run(argv, io)` shape in `captureRun` and `runInteractive`.

  Inert command definitions are not directly runnable; mount them into an application before passing them to either helper.
