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

- **Standalone binaries (recommended)**: compile with `crust build` and publish `dist/` only.
- **Bun runtime package**: distribute with runtime dependencies (`@crustjs/core` and `@crustjs/plugins` in `dependencies`).

## Publishing

- **Standalone binaries**: keep `files: ["dist"]`, `bin` -> `dist/cli`, and use `prepack` (`bun run build`).
- **Bun runtime package**: keep `bin` -> `dist/cli.js`, build with Bun (`bun build ... --outfile dist/cli.js`), and keep runtime deps in `dependencies`.

## Usage

```sh
# Run the CLI
{{name}} world
{{name}} --greet Hey world
```
