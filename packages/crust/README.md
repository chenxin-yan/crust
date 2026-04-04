# @crustjs/crust

CLI tooling for the [Crust](https://crustjs.com) framework.

> For the framework API, install [`@crustjs/core`](https://www.npmjs.com/package/@crustjs/core).

## Install

```sh
bun add -d @crustjs/crust
```

## CLI Commands

The `crust` binary provides three distinct workflows:

| Command                    | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `crust build`              | Compile raw standalone Bun executable(s)       |
| `crust build --man`        | Also write `mdoc(7)` to `<outdir>/man/<name>.1` |
| `crust build --package`    | Stage per-platform npm packages in `dist/npm`  |
| `crust publish`            | Publish an existing staged `dist/npm` manifest |

### `crust build`

Compiles your CLI entry file to standalone Bun executables.

**By default, builds for all 6 supported platforms** and generates a shell resolver script that detects the host platform at runtime and runs the correct binary. This makes it easy to distribute your CLI as a single npm package that works everywhere — no runtime (Node.js or Bun) required.

```sh
crust build                          # All platforms + shell resolver (default)
crust build --entry src/main.ts      # Custom entry point
crust build --name my-tool           # Set base binary name
crust build --no-minify              # Disable minification
crust build --env-file .env.production  # Explicit build-time env file
crust build --man                      # Emit man page (export Crust as `app` or default)
```

To build for specific platform(s) only, use `--target`:

```sh
crust build --target linux-x64                          # Single platform
crust build --target linux-x64 --target darwin-arm64    # Multiple platforms
crust build --target linux-x64 --outfile ./my-cli       # Custom output (single target only)
crust build --env-file .env --env-file .env.local       # Repeatable env files
```

#### Supported Targets

| Alias           | Bun Target                 | Platform            |
| --------------- | -------------------------- | ------------------- |
| `linux-x64`     | `bun-linux-x64-baseline`   | Linux x86_64        |
| `linux-arm64`   | `bun-linux-arm64`          | Linux ARM64         |
| `darwin-x64`    | `bun-darwin-x64`           | macOS Intel         |
| `darwin-arm64`  | `bun-darwin-arm64`         | macOS Apple Silicon |
| `windows-x64`   | `bun-windows-x64-baseline` | Windows x86_64      |
| `windows-arm64` | `bun-windows-arm64`        | Windows ARM64       |

#### Flags

| Flag         | Alias | Type        | Default             | Description                                                |
| ------------ | ----- | ----------- | ------------------- | ---------------------------------------------------------- |
| `--entry`    | `-e`  | `"string"`  | `src/cli.ts`        | Entry file path                                            |
| `--outfile`  | `-o`  | `"string"`  | —                   | Output file path (single-target builds only)               |
| `--name`     | `-n`  | `"string"`  | package.json `name` | Base binary name                                           |
| `--minify`   | —     | `"boolean"` | `true`              | Minify the output                                          |
| `--target`   | `-t`  | `"string"`  | _(all platforms)_   | Target platform(s); repeatable                             |
| `--outdir`   | `-d`  | `"string"`  | `dist`              | Output directory for compiled binaries                     |
| `--resolver` | `-r`  | `"string"`  | `cli`               | Resolver script filename (multi-target only, no extension) |
| `--env-file` | —     | `"string"`  | —                   | Explicit env file(s) used for build-time constants         |
| `--validate` | —     | `"boolean"` | `true`              | Pre-compile validation of command definitions              |
| `--package` | —   | `"boolean"` | `false`             | Stage npm packages in `dist/npm` instead of raw binaries   |
| `--stage-dir` | —    | `"string"`  | `dist/npm`          | Staging directory used with `--package`                    |

#### Output

**All-platform build** (default, no `--target`):

```
dist/
  cli                               # Shell resolver (entry point for npm bin)
  cli.cmd                           # Windows batch resolver
  my-cli-bun-linux-x64-baseline     # Linux x64 binary
  my-cli-bun-linux-arm64            # Linux ARM64 binary
  my-cli-bun-darwin-x64             # macOS Intel binary
  my-cli-bun-darwin-arm64           # macOS Apple Silicon binary
  my-cli-bun-windows-x64-baseline.exe  # Windows x64 binary
  my-cli-bun-windows-arm64.exe      # Windows ARM64 binary
```

**Single-target build** (`--target <alias>`):

```
dist/
  my-cli                            # Single binary (no resolver)
```

`crust build` is the raw binary workflow by default. Add `--package` when you want staged npm packages instead of raw `dist/` binaries.

#### Environment Variables

Compiled executables still use Bun's **runtime env** behavior. Build-time constants follow Bun's `PUBLIC_*` env-prefix model, sourcing values from Bun's auto-loaded cwd env by default or from explicit `--env-file` inputs.

`PUBLIC_*` values are embedded in the binary and are therefore public.

See the full guide: [Environment Variables](https://crustjs.com/docs/guide/environment)

### `crust build --package`

Stages a root npm package plus one npm package per supported target for optionalDependency-based distribution.

```sh
crust build --package
crust build --package --target linux-x64
crust build --package --stage-dir .crust/npm
crust build --package --env-file .env.production
```

#### Output

```text
dist/npm/
  manifest.json
  root/
    package.json
    bin/my-cli.js
  linux-x64/
    package.json
    bin/my-cli-bun-linux-x64-baseline
  linux-arm64/
    package.json
    bin/my-cli-bun-linux-arm64
  darwin-x64/
    package.json
    bin/my-cli-bun-darwin-x64
  darwin-arm64/
    package.json
    bin/my-cli-bun-darwin-arm64
  windows-x64/
    package.json
    bin/my-cli-bun-windows-x64-baseline.exe
  windows-arm64/
    package.json
    bin/my-cli-bun-windows-arm64.exe
```

The generated root package contains a JS resolver plus `optionalDependencies` on the platform packages. Each platform package is tagged with npm `os` / `cpu` metadata and contains only its native binary. npm generates the platform launchers from the root package `bin` entry during install, so Crust does not stage its own `.cmd` file for `--package`.

`crust build --package` is the npm-packaging workflow. The staged interface is:

- `dist/npm/root`
- `dist/npm/<target>`
- `dist/npm/manifest.json`

`manifest.json` records the root package, staged platform packages, and publish order.

### `crust publish`

Publishes the already-staged directories from `crust build --package`.

```sh
crust publish
crust publish --dry-run
crust publish --stage-dir .crust/npm --tag next
```

#### Flags

| Flag          | Type        | Default    | Description                                          |
| ------------- | ----------- | ---------- | ---------------------------------------------------- |
| `--stage-dir` | `"string"`  | `dist/npm` | Directory containing the staged `manifest.json`      |
| `--tag`       | `"string"`  | —          | npm dist-tag passed to `bun publish`                 |
| `--access`    | `"string"`  | `public`   | npm access level passed to `bun publish`             |
| `--dry-run`   | `"boolean"` | `false`    | Print publish order and commands without publishing   |
| `--verify`    | `"boolean"` | `true`     | Verify staged directories and metadata before publish |
| `--registry`  | `"string"`  | —          | Override the npm registry URL                        |

`crust publish` does not rebuild or restage anything. It reads `manifest.json`, verifies the staged package metadata, publishes platform packages first, and publishes `root/` last.

## Recommended Flow

1. `crust build` — compile raw binaries
2. `crust build --package` — stage per-platform npm packages
3. `crust publish` — publish staged packages to the registry

The three steps are intentionally separate:

- `build` produces raw binary artifacts.
- `build --package` creates npm-ready staged packages.
- `publish` uploads the staged packages to the registry.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
