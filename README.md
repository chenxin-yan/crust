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
  <a href="https://crustjs.com">Website & Docs</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="./CONTRIBUTING.md">Contributing</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/chenxin-yan/crust/issues">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://discord.gg/sQF8hdN6Ht">Discord</a>
</p>

## What is Crust?

Crust is a modern CLI framework built specifically for TypeScript and Bun. It provides a modular architecture for building command-line tools with features like command routing, argument parsing, interactive prompts, validation, and persistence—all with first-class TypeScript support.

## Who uses Crust?

- [Nia CLI](https://github.com/nozomio-labs/nia-cli) by [Nozomio Labs](https://www.trynia.ai/)

## Getting Started

```sh
bun create crust my-cli
cd my-cli
bun run dev
```

## Packages

| Package                                                                    | Description                                                                      | Version                                                                                                       | Downloads                                                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`@crustjs/crust`](https://www.npmjs.com/package/@crustjs/crust)           | CLI tooling — build and distribute standalone executables                        | [![npm](https://img.shields.io/npm/v/@crustjs/crust)](https://www.npmjs.com/package/@crustjs/crust)           | [![downloads](https://img.shields.io/npm/dm/@crustjs/crust)](https://www.npmjs.com/package/@crustjs/crust)           |
| [`@crustjs/core`](https://www.npmjs.com/package/@crustjs/core)             | Core: command definition, arg parsing, routing, extensions, errors               | [![npm](https://img.shields.io/npm/v/@crustjs/core)](https://www.npmjs.com/package/@crustjs/core)             | [![downloads](https://img.shields.io/npm/dm/@crustjs/core)](https://www.npmjs.com/package/@crustjs/core)             |
| [`@crustjs/man`](https://www.npmjs.com/package/@crustjs/man)               | Generate man pages from Crust command definitions                                | [![npm](https://img.shields.io/npm/v/@crustjs/man)](https://www.npmjs.com/package/@crustjs/man)               | [![downloads](https://img.shields.io/npm/dm/@crustjs/man)](https://www.npmjs.com/package/@crustjs/man)               |
| [`@crustjs/testing`](https://www.npmjs.com/package/@crustjs/testing)       | Test harness for Crust CLI applications                                          | [![npm](https://img.shields.io/npm/v/@crustjs/testing)](https://www.npmjs.com/package/@crustjs/testing)       | [![downloads](https://img.shields.io/npm/dm/@crustjs/testing)](https://www.npmjs.com/package/@crustjs/testing)       |
| [`@crustjs/extensions`](https://www.npmjs.com/package/@crustjs/extensions) | Official Extensions: help, version, completion                                   | [![npm](https://img.shields.io/npm/v/@crustjs/extensions)](https://www.npmjs.com/package/@crustjs/extensions) | [![downloads](https://img.shields.io/npm/dm/@crustjs/extensions)](https://www.npmjs.com/package/@crustjs/extensions) |
| [`@crustjs/style`](https://www.npmjs.com/package/@crustjs/style)           | Terminal styling foundation                                                      | [![npm](https://img.shields.io/npm/v/@crustjs/style)](https://www.npmjs.com/package/@crustjs/style)           | [![downloads](https://img.shields.io/npm/dm/@crustjs/style)](https://www.npmjs.com/package/@crustjs/style)           |
| [`@crustjs/progress`](https://www.npmjs.com/package/@crustjs/progress)     | Progress indicators for async CLI tasks                                          | [![npm](https://img.shields.io/npm/v/@crustjs/progress)](https://www.npmjs.com/package/@crustjs/progress)     | [![downloads](https://img.shields.io/npm/dm/@crustjs/progress)](https://www.npmjs.com/package/@crustjs/progress)     |
| [`@crustjs/prompts`](https://www.npmjs.com/package/@crustjs/prompts)       | Interactive terminal prompts                                                     | [![npm](https://img.shields.io/npm/v/@crustjs/prompts)](https://www.npmjs.com/package/@crustjs/prompts)       | [![downloads](https://img.shields.io/npm/dm/@crustjs/prompts)](https://www.npmjs.com/package/@crustjs/prompts)       |
| [`@crustjs/store`](https://www.npmjs.com/package/@crustjs/store)           | DX-first, typed persistence for CLI apps with config/data/state/cache separation | [![npm](https://img.shields.io/npm/v/@crustjs/store)](https://www.npmjs.com/package/@crustjs/store)           | [![downloads](https://img.shields.io/npm/dm/@crustjs/store)](https://www.npmjs.com/package/@crustjs/store)           |
| [`@crustjs/skills`](https://www.npmjs.com/package/@crustjs/skills)         | Agent skill generation from Crust command definitions                            | [![npm](https://img.shields.io/npm/v/@crustjs/skills)](https://www.npmjs.com/package/@crustjs/skills)         | [![downloads](https://img.shields.io/npm/dm/@crustjs/skills)](https://www.npmjs.com/package/@crustjs/skills)         |
| [`@crustjs/create`](https://www.npmjs.com/package/@crustjs/create)         | Headless scaffolding engine for building create-xxx tools                        | [![npm](https://img.shields.io/npm/v/@crustjs/create)](https://www.npmjs.com/package/@crustjs/create)         | [![downloads](https://img.shields.io/npm/dm/@crustjs/create)](https://www.npmjs.com/package/@crustjs/create)         |
| [`create-crust`](https://www.npmjs.com/package/create-crust)               | Project scaffolding tool                                                         | [![npm](https://img.shields.io/npm/v/create-crust)](https://www.npmjs.com/package/create-crust)               | [![downloads](https://img.shields.io/npm/dm/create-crust)](https://www.npmjs.com/package/create-crust)               |
