# <%~ it.name %>

A CLI built with [Crust](https://crustjs.com).

Runtime: **<%~ it.runtime %>**. Build output: **<%~ it.artifact %>**.
Change `crust.runtime` and `crust.artifact` in `package.json` to change these choices.

## Development

Install dependencies if you skipped installation or just cloned the project:

```sh
<%~ it.install %>
```

```sh
# Run in dev mode
<%~ it.run %> dev

# Type-check
<%~ it.run %> check:types

# Build into .crust/
<%~ it.run %> build

# Run the built CLI
<%~ it.run %> start
```

## Build and distribution

`<%~ it.run %> build` stages the selected output and npm metadata in `.crust/`:

- `package`: a JavaScript bundle in `.crust/root/` that requires the selected runtime installed.
- `binary`: a standalone executable per platform, with its runtime embedded. Pass `--target host` to `crust build` to build only this machine's target.

Bun is used for build preparation and Bun/Node bundling. Node binaries additionally need Node 26+ and Crust's optional compiler backend; Deno builds need Deno on PATH, with Deno 2.5+ required for experimental runtime-package bundling. Crust does not install or upgrade compilers. See [compiler requirements](https://crustjs.com/docs/guide/build-and-distribution#binary-runtime-version).

`<%~ it.run %> release` publishes the staged packages to npm, but npm is optional. For direct downloads, Homebrew or Scoop, distribute the executable and adjacent assets from `.crust/<platform>/bin/`. Direct binaries need no separately installed JavaScript runtime; the generated npm binary launcher needs Node.js. Crust does not generate installer definitions or publish release archives. See [custom distribution](https://crustjs.com/docs/guide/build-and-distribution#custom-distribution).

## Usage

```sh
# Run the CLI
<%~ it.name %> world
<%~ it.name %> --greet Hey world
```
