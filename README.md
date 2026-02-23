<h1 align="center">
  <img src="assets/crust-logo.png" alt="Crust logo" width="120">
  <br>
  Crust
</h1>
<p align="center">A TypeScript-first, Bun-native CLI framework with composable modules.</p>

<p align="center">
  <a href="https://github.com/chenxin-yan/crust/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@crustjs/crust" alt="license"></a>
  <a href="https://github.com/chenxin-yan/crust"><img src="https://img.shields.io/github/stars/chenxin-yan/crust" alt="stars"></a>
</p>

<p align="center">
  <a href="https://crustjs.com">Documentation</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/chenxin-yan/crust/issues">Issues</a>
</p>

> [!WARNING]
> Crust is **beta-quality** until v1.0. Versions before 1.0 do not strictly follow semantic versioning. The core API should be relatively stable after 0.1, but expect breaking changes between minor releases.

## Packages

| Package | Description | Version | Downloads |
| --- | --- | --- | --- |
| [`@crustjs/crust`](https://www.npmjs.com/package/@crustjs/crust) | CLI tooling — build and distribute standalone executables | [![npm](https://img.shields.io/npm/v/@crustjs/crust)](https://www.npmjs.com/package/@crustjs/crust) | [![downloads](https://img.shields.io/npm/dm/@crustjs/crust)](https://www.npmjs.com/package/@crustjs/crust) |
| [`@crustjs/core`](https://www.npmjs.com/package/@crustjs/core) | Core: command definition, arg parsing, routing, plugins, errors | [![npm](https://img.shields.io/npm/v/@crustjs/core)](https://www.npmjs.com/package/@crustjs/core) | [![downloads](https://img.shields.io/npm/dm/@crustjs/core)](https://www.npmjs.com/package/@crustjs/core) |
| [`@crustjs/plugins`](https://www.npmjs.com/package/@crustjs/plugins) | Official plugins: help, version, autocomplete | [![npm](https://img.shields.io/npm/v/@crustjs/plugins)](https://www.npmjs.com/package/@crustjs/plugins) | [![downloads](https://img.shields.io/npm/dm/@crustjs/plugins)](https://www.npmjs.com/package/@crustjs/plugins) |
| [`@crustjs/style`](https://www.npmjs.com/package/@crustjs/style) | Terminal styling foundation | [![npm](https://img.shields.io/npm/v/@crustjs/style)](https://www.npmjs.com/package/@crustjs/style) | [![downloads](https://img.shields.io/npm/dm/@crustjs/style)](https://www.npmjs.com/package/@crustjs/style) |
| [`@crustjs/prompts`](https://www.npmjs.com/package/@crustjs/prompts) | Interactive terminal prompts | [![npm](https://img.shields.io/npm/v/@crustjs/prompts)](https://www.npmjs.com/package/@crustjs/prompts) | [![downloads](https://img.shields.io/npm/dm/@crustjs/prompts)](https://www.npmjs.com/package/@crustjs/prompts) |
| [`@crustjs/validate`](https://www.npmjs.com/package/@crustjs/validate) | Validation helpers | [![npm](https://img.shields.io/npm/v/@crustjs/validate)](https://www.npmjs.com/package/@crustjs/validate) | [![downloads](https://img.shields.io/npm/dm/@crustjs/validate)](https://www.npmjs.com/package/@crustjs/validate) |
| [`@crustjs/create`](https://www.npmjs.com/package/@crustjs/create) | Headless scaffolding engine for building create-xxx tools | [![npm](https://img.shields.io/npm/v/@crustjs/create)](https://www.npmjs.com/package/@crustjs/create) | [![downloads](https://img.shields.io/npm/dm/@crustjs/create)](https://www.npmjs.com/package/@crustjs/create) |
| [`create-crust`](https://www.npmjs.com/package/create-crust) | Project scaffolding tool | [![npm](https://img.shields.io/npm/v/create-crust)](https://www.npmjs.com/package/create-crust) | [![downloads](https://img.shields.io/npm/dm/create-crust)](https://www.npmjs.com/package/create-crust) |

## Getting Started

```sh
bun create crust my-cli
cd my-cli
bun run dev
```
