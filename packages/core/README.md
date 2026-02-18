# @crust/core

The core library for the [Crust](https://crust.cyanlabs.co) CLI framework.

Provides command definition, argument/flag parsing, subcommand routing, lifecycle hooks, and a plugin system — with **zero runtime dependencies**.

## Install

```sh
bun add @crust/core
```

## Quick Example

```ts
import { defineCommand, runMain } from "@crust/core";

const main = defineCommand({
  meta: { name: "greet", description: "Say hello" },
  args: [{ name: "name", type: String, default: "world" }],
  flags: {
    loud: { type: Boolean, description: "Shout it", alias: "l" },
  },
  run({ args, flags }) {
    const msg = `Hello, ${args.name}!`;
    console.log(flags.loud ? msg.toUpperCase() : msg);
  },
});

runMain(main);
```

## Documentation

See the full docs at [crust.cyanlabs.co](https://crust.cyanlabs.co).

## License

MIT
