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

### `crust build`

Compiles your CLI entry file to standalone Bun executables using the `Bun.build()` API.

**By default, builds for all 5 supported platforms** and generates a shell resolver script that detects the host platform at runtime and runs the correct binary. This makes it easy to distribute your CLI as a single npm package that works everywhere — no runtime (Node.js or Bun) required.

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

| Alias          | Bun Target                 | Platform            |
| -------------- | -------------------------- | ------------------- |
| `linux-x64`    | `bun-linux-x64-baseline`   | Linux x86_64        |
| `linux-arm64`  | `bun-linux-arm64`          | Linux ARM64         |
| `darwin-x64`   | `bun-darwin-x64`           | macOS Intel         |
| `darwin-arm64`  | `bun-darwin-arm64`         | macOS Apple Silicon |
| `windows-x64`  | `bun-windows-x64-baseline` | Windows x86_64      |

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
```

**Single-target build** (`--target <alias>`):

```
dist/
  my-cli                            # Single binary (no resolver)
```

#### Distributing via npm

After building for all platforms, configure your `package.json` to use the shell resolver as the bin entry:

```json
{
  "name": "my-cli",
  "bin": {
    "my-cli": "dist/cli"
  },
  "files": ["dist"]
}
```

The resolver is a `#!/usr/bin/env bash` script (with a companion `.cmd` for Windows) that requires no runtime — it detects the platform and directly executes the correct prebuilt binary.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
