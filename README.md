# Crust

A Bun-native, TypeScript-first CLI framework with a composable package ecosystem.

## Documentation

Visit [crust.cyanlabs.co](https://crust.cyanlabs.co) for full documentation, guides, and API reference.

## Features

- **Zero runtime dependencies** — the main packages have no external dependencies
- **Subcommand routing** — nested command trees with automatic resolution
- **Plugins** — middleware-based plugins system
- **Lifecycle hooks** — `preRun`, `run`, `postRun` with async support

## Why Crust?

Most CLI tools in the JavaScript ecosystem fall into two camps: **minimal arg parsers** that leave you wiring everything together, or **heavyweight frameworks** that bring too much complexity for what you need.

```
   Minimal                                                         Full Framework

      ┃                                                                   ┃
      ┃   meow     citty    yargs   commander   Crust             oclif   ┃
      ┗━━━━━●━━━━━━━━●━━━━━━━●━━━━━━━━━●━━━━━━━━━━★━━━━━━━━━━━━━━━━●━━━━━━┛
```

Crust sits in the sweet spot — more feature rich than a parser, lighter than a full framework, and because every capability ships as its own composable package, you only pull in what you actually use.

## Philosophy

- **Declarative** — Define commands as plain objects. Crust handles parsing, validation, and routing for you.
- **TypeScript-first** — Args and flags are fully inferred from definitions. No manual type annotations needed.
- **Composable** — Each package is standalone and opt-in. Use only what you need.
- **Minimal** — A small, focused API surface that scales from simple scripts to complex CLI tools.
- **Bun-first** — Built for Bun from the ground up.

## Packages

| Package           | Description                                 |
| ----------------- | ------------------------------------------- |
| `@crust/core`     | Core library                                |
| `@crust/plugins`  | Official plugins                            |
| `@crust/validate` | Input validation & coercion _(coming soon)_ |
| `@crust/prompt`   | Interactive prompts _(coming soon)_         |
| `@crust/color`    | Terminal styling & colors _(coming soon)_   |
| `crust`           | all-in-one package with CLI tooling         |
| `create-crust`    | Project scaffolder                          |

## License

MIT
