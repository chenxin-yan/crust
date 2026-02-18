# @crustjs/plugins

Official plugins for the [Crust](https://crust.cyanlabs.co) CLI framework.

## Install

```sh
bun add @crustjs/plugins
```

## Plugins

| Plugin | Description |
| --- | --- |
| `helpPlugin()` | Adds `--help` / `-h` flag and auto-generates help text |
| `versionPlugin(version)` | Adds `--version` / `-v` flag |
| `autoCompletePlugin(options?)` | Shell autocompletion support |

## Usage

```ts
import { defineCommand, runMain } from "@crustjs/core";
import { helpPlugin, versionPlugin, autoCompletePlugin } from "@crustjs/plugins";

const main = defineCommand({
  meta: { name: "my-cli", description: "My CLI tool" },
  run() {
    console.log("Hello!");
  },
});

runMain(main, {
  plugins: [versionPlugin("1.0.0"), autoCompletePlugin(), helpPlugin()],
});
```

## Documentation

See the full docs at [crust.cyanlabs.co](https://crust.cyanlabs.co).

## License

MIT
