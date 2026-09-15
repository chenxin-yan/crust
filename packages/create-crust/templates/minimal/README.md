# {{name}}

A CLI built with [Crust](https://crustjs.com).

## Development

```sh
# Run in dev mode
{{run}} dev

# Type-check
{{run}} check:types

# Build distribution output
{{run}} build
```

## Publishing

`{{run}} build` writes the distributable output to `dist/`. The remaining `package.json` scripts depend on the runtime you picked when scaffolding; see [Build and distribution](https://crustjs.com/docs/guide/build-and-distribution).

## Usage

```sh
# Run the CLI
{{name}} world
{{name}} --greet Hey world
```
