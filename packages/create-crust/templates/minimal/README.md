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

- **Standalone binaries (recommended)**: compile with `crust build`, then stage npm-ready platform packages with `crust package`.
- **Bun runtime package**: distribute with runtime dependencies (`@crustjs/core` and `@crustjs/plugins` in `dependencies`).

## Publishing

- **Standalone binaries**: use `bun run package`, then publish the staged package directories from `dist/npm/` with the platform packages first and `root/` last.
- **Bun runtime package**: keep `bin` -> `dist/cli.js`, build with Bun (`bun build ... --outfile dist/cli.js`), and keep runtime deps in `dependencies`.

## Usage

```sh
# Run the CLI
{{name}} world
{{name}} --greet Hey world
```
