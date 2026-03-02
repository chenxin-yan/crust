# @crustjs/core

The core library for the [Crust](https://crustjs.com) CLI framework.

Provides command definition, argument/flag parsing, subcommand routing, lifecycle hooks, and a plugin system — with **zero runtime dependencies**.

## Install

```sh
bun add @crustjs/core
```

## Quick Example

```ts
import { Crust } from "@crustjs/core";

const app = new Crust({ name: "greet", description: "Say hello" })
  .args([{ name: "name", type: "string", default: "world" }] as const)
  .flags({
    loud: { type: "boolean", description: "Shout it", alias: "l" },
  })
  .run(({ args, flags }) => {
    const msg = `Hello, ${args.name}!`;
    console.log(flags.loud ? msg.toUpperCase() : msg);
  });

app.execute();
```

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
