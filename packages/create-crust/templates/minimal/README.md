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

## Publishing

- **Standalone binaries**: `bun run package` stages npm packages in `dist/npm/`, then `bun run publish` uploads them in manifest order. The staged packages get their own generated `package.json`; see [Build and distribution](https://crustjs.com/docs/guide/build-and-distribution).
- **Bun runtime package**: `npm publish` runs `bun run build` via `prepack` and ships `dist/cli.js`, which needs Bun on the user's machine.

## Usage

```sh
# Run the CLI
{{name}} world
{{name}} --greet Hey world
```
