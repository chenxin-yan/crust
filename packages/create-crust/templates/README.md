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

# Run the tests in src/*.test.ts
<%~ it.run %> test

# Type-check
<%~ it.run %> check:types

# Build into .crust/
<%~ it.run %> build

# Run the built CLI
<%~ it.run %> start
```

## Build and distribution

`<%~ it.run %> build` type-checks the project with `tsc --noEmit`, then stages the selected output and npm metadata in `.crust/`:

- `package`: a JavaScript bundle in `.crust/root/` that requires the selected runtime installed.
- `binary`: a standalone executable per platform, with its runtime embedded. `crust.targets` in `package.json` lists the platforms a release ships: `<%~ it.run %> build` builds every one, and `<%~ it.run %> release` builds and publishes them. Remove the platforms you do not ship. Pass `--target <name>` to `crust build` to build one target, such as this machine's.

Bun is used for build preparation and Bun/Node bundling. Node binaries additionally need Node 26+ and Crust's optional compiler backend. Crust does not install or upgrade compilers. See [compiler requirements](https://crustjs.com/docs/guide/build-and-distribution#binary-runtime-version).

`<%~ it.run %> release` builds and publishes the packages to npm, but npm is optional. For direct downloads, Homebrew or Scoop, distribute the executable and adjacent assets from `.crust/<platform>/bin/`. Direct binaries need no separately installed JavaScript runtime; the generated npm binary launcher needs Node.js. Crust does not generate installer definitions or publish release archives. See [custom distribution](https://crustjs.com/docs/guide/build-and-distribution#custom-distribution).

## Usage

```sh
# Run the CLI
<%~ it.name %> world
<%~ it.name %> --greet Hey world
```
