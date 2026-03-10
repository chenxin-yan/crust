# @crustjs/crust

CLI tooling for the [Crust](https://crustjs.com) framework — build and distribute standalone executables.

> For the framework API (`defineCommand`, `runMain`, plugins, etc.), install [`@crustjs/core`](https://www.npmjs.com/package/@crustjs/core) and [`@crustjs/plugins`](https://www.npmjs.com/package/@crustjs/plugins).

## Install

```sh
bun add -d @crustjs/crust
```

## CLI Commands

The `crust` binary provides build tooling for your Crust-powered CLI:

| Command       | Description                                      |
| ------------- | ------------------------------------------------ |
| `crust build` | Compile your CLI to standalone Bun executable(s) |
| `crust package` | Stage npm packages for platform-specific binary publishing |

### `crust build`

Compiles your CLI entry file to standalone Bun executables using the `Bun.build()` API.

**By default, builds for all 6 supported platforms** and generates a shell resolver script that detects the host platform at runtime and runs the correct binary. This makes it easy to distribute your CLI as a single npm package that works everywhere — no runtime (Node.js or Bun) required.

```sh
crust build                          # All platforms + shell resolver (default)
crust build --entry src/main.ts      # Custom entry point
crust build --name my-tool           # Set base binary name
crust build --no-minify              # Disable minification
```

To build for specific platform(s) only, use `--target`:

```sh
crust build --target linux-x64                          # Single platform
crust build --target linux-x64 --target darwin-arm64    # Multiple platforms
crust build --target linux-x64 --outfile ./my-cli       # Custom output (single target only)
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

| Flag        | Alias | Type      | Default             | Description                                  |
| ----------- | ----- | --------- | ------------------- | -------------------------------------------- |
| `--entry`   | `-e`  | `"string"`  | `src/cli.ts`        | Entry file path                              |
| `--outfile` | `-o`  | `"string"`  | —                   | Output file path (single-target builds only) |
| `--name`    | `-n`  | `"string"`  | package.json `name` | Base binary name                             |
| `--minify`  | —     | `"boolean"` | `true`              | Minify the output                            |
| `--target`  | `-t`  | `"string"`  | _(all platforms)_   | Target platform(s); repeatable               |
| `--outdir`  | `-d`  | `"string"`  | `dist`              | Output directory for compiled binaries       |
| `--resolver` | `-r` | `"string"`  | `cli`               | Resolver script filename (multi-target only, no extension) |
| `--validate` | —    | `"boolean"` | `true`              | Pre-compile validation of command definitions |

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

`crust build` is the raw binary-output command. It is still useful for local artifacts, direct binary distribution, and non-npm packaging.

### `crust package`

Stages a root npm package plus one npm package per supported target for optionalDependency-based distribution.

```sh
crust package                          # Stage all targets into dist/npm
crust package --target linux-x64       # Stage a subset of platforms
crust package --stage-dir .crust/npm   # Custom staging directory
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

The generated root package contains a small JS launcher and `optionalDependencies` on the platform packages. Each platform package is tagged with npm `os` / `cpu` metadata and contains only its native binary.

#### Publishing the staged packages

1. Run `crust package`.
2. Publish each platform package directory in `dist/npm/` first.
3. Publish `dist/npm/root` last.

`dist/npm/manifest.json` records the staged directories and publish order.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
