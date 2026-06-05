# @crustjs/core

The core library for the [Crust](https://crustjs.com) CLI framework.

Provides command definition, argument/flag parsing, subcommand routing, lifecycle hooks, and a plugin system.

## Install

```sh
bun add @crustjs/core
```

## Quick Example

```ts
import { Crust } from "@crustjs/core";

const app = new Crust("greet")
	.meta({ description: "Say hello" })
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

## Built-in value types

Flags and positional arguments support six built-in `type` literals:

- `"string"` — raw string token
- `"number"` — coerced via `Number(raw)`
- `"boolean"` — toggle (`--flag` / `--no-flag`)
- `"url"` — `new URL(raw)` → `URL` instance
- `"path"` — `~` expanded, resolved to an absolute `string`
- `"json"` — `JSON.parse(raw)` → `unknown`

For formats that aren't built in, attach a synchronous `parse` to a `type: "string"` flag or arg. The inferred type flows from `ReturnType<parse>`:

```ts
flags: {
  port: { type: "string", parse: (s) => Number(s), default: "3000" },
}
// flags.port: number
```

See the [Types](https://crustjs.com/docs/guide/types) guide for the full contract, error modes, and copy-paste recipes.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
