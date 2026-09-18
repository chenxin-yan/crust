# {{name}}

A CLI built with [Crust](https://crustjs.com).

## Development

```sh
# Run in dev mode
{{run}} dev

# Type-check
{{run}} check:types

# Build into .crust/
{{run}} build

# Run the built CLI
{{run}} start
```

## Publishing

`{{run}} build` stages the publishable npm package(s) in `.crust/`; `{{run}} release` publishes them. See [Build and distribution](https://crustjs.com/docs/guide/build-and-distribution).

## Usage

```sh
# Run the CLI
{{name}} world
{{name}} --greet Hey world
```
