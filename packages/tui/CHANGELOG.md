# @crustjs/tui

## 0.0.2

### Patch Changes

- [#371](https://github.com/chenxin-yan/crust/pull/371) [`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the supported Bun floor to 1.4.0.
  
  Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.

## 0.0.1

### Patch Changes

- [#364](https://github.com/chenxin-yan/crust/pull/364) [`05d7e3e`](https://github.com/chenxin-yan/crust/commit/05d7e3e7f79fa1aea722f5dafaf4958886418105) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add a Bun-only OpenTUI adapter with TTY gating, renderer lifecycle management, framework-agnostic mounting, and Ctrl+C cancellation compatible with Crust exit code 130.
