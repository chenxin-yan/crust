# @crustjs/core

The core library for the [Crust](https://crustjs.com) CLI framework.

Provides command definition, argument/flag parsing, subcommand routing, lifecycle hooks, and a plugin system — with **zero runtime dependencies**.

## Install

```sh
bun add @crustjs/core
```

## Quick Example

```ts
import { defineCommand, runMain } from "@crustjs/core";

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

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
