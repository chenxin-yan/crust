# @crustjs/crust

The all-in-one package for the [Crust](https://crustjs.com) CLI framework.

Re-exports everything from `@crustjs/core` and `@crustjs/plugins`, plus provides CLI tooling for building Crust-powered CLIs.

## Install

```sh
bun add @crustjs/crust
```

## Framework API

The `@crustjs/crust` package gives you the full framework API in a single import:

```ts
import {
  defineCommand,
  runMain,
  helpPlugin,
  versionPlugin,
} from "@crustjs/crust";

const main = defineCommand({
  meta: { name: "my-cli", description: "My CLI tool" },
  run() {
    console.log("Hello!");
  },
});

runMain(main, {
  plugins: [versionPlugin("1.0.0"), helpPlugin()],
});
```

> For granular control, you can install `@crustjs/core` and `@crustjs/plugins` separately.

## CLI Commands

When installed, the `crust` binary provides tooling for your project:

| Command       | Description                                      |
| ------------- | ------------------------------------------------ |
| `crust build` | Compile your CLI to standalone Bun executable(s) |

### `crust build`

Compiles your CLI entry file to standalone Bun executables using `bun build --compile`.

**By default, builds for all 5 supported platforms** and generates a JS resolver script that detects the host platform at runtime and runs the correct binary. This makes it easy to distribute your CLI as a single npm package that works everywhere.

```sh
crust build                          # All platforms + JS resolver (default)
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
| `darwin-arm64` | `bun-darwin-arm64`         | macOS Apple Silicon |
| `windows-x64`  | `bun-windows-x64-baseline` | Windows x86_64      |

#### Flags

| Flag        | Alias | Type      | Default             | Description                                  |
| ----------- | ----- | --------- | ------------------- | -------------------------------------------- |
| `--entry`   | `-e`  | `String`  | `src/cli.ts`        | Entry file path                              |
| `--outfile` | `-o`  | `String`  | —                   | Output file path (single-target builds only) |
| `--name`    | `-n`  | `String`  | package.json `name` | Base binary name                             |
| `--minify`  | —     | `Boolean` | `true`              | Minify the output                            |
| `--target`  | `-t`  | `String`  | _(all platforms)_   | Target platform(s); repeatable               |

#### Output

**All-platform build** (default, no `--target`):

```
dist/
  my-cli.js                         # JS resolver (entry point for npm bin)
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

After building for all platforms, configure your `package.json` to use the JS resolver as the bin entry:

```json
{
  "name": "my-cli",
  "bin": {
    "my-cli": "dist/my-cli.js"
  },
  "files": ["dist"]
}
```

The resolver uses `#!/usr/bin/env node` for maximum compatibility when installed globally via npm (works even when Bun is not installed on the end user's machine).

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
