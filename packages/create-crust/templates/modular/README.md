# {{name}}

A modular CLI built with [Crust](https://crustjs.com).

This template demonstrates the file-splitting pattern with `.sub()` and `.command(builder)`.

## Development

```sh
# Run in dev mode
bun run dev

# Type-check
bun run check:types

# Build standalone executable
bun run build
```

## Usage

```sh
# Run the greet subcommand
{{name}} greet world
{{name}} greet --greet Hey world

# Show help
{{name}} --help
```
