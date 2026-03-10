# {{name}}

A CLI built with [Crust](https://crustjs.com).

## Development

```sh
# Run in dev mode
bun run dev

# Type-check
bun run check:types

# Build distribution output
bun run build
```

This template supports two distribution modes:

- **Standalone binaries (recommended)**: use `bun run build` for raw binaries, then `bun run distribute` for npm-ready staged packages.
- **Bun runtime package**: distribute with runtime dependencies (`@crustjs/core` and `@crustjs/plugins` in `dependencies`).

## Publishing

- **Standalone binaries**:
  `bun run build` produces raw binaries.
  `bun run distribute` stages npm packages in `dist/npm/`.
  `bun run publish` publishes the staged packages in manifest order.
- **Bun runtime package**: keep `bin` -> `dist/cli.js`, build with Bun (`bun build ... --outfile dist/cli.js`), and keep runtime deps in `dependencies`.

## Usage

```sh
# Run the CLI
{{name}} world
{{name}} --greet Hey world
```
