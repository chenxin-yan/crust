# @crustjs/crust

The all-in-one package for the [Crust](https://crust.cyanlabs.co) CLI framework.

Re-exports everything from `@crustjs/core` and `@crustjs/plugins`, plus provides CLI tooling for building Crust-powered CLIs.

## Install

```sh
bun add @crustjs/crust
```

## Framework API

The `@crustjs/crust` package gives you the full framework API in a single import:

```ts
import { defineCommand, runMain, helpPlugin, versionPlugin } from "@crustjs/crust";

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

| Command | Description |
| --- | --- |
| `crust build` | Compile your CLI to a standalone Bun executable |

## Documentation

See the full docs at [crust.cyanlabs.co](https://crust.cyanlabs.co).

## License

MIT
