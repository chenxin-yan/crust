# @crustjs/core

Core library for the Crust CLI framework.

## Install

```sh
bun add @crustjs/core
```

## Quick example

```ts
import { Crust } from "@crustjs/core";

const app = new Crust("hello")
	.flags({ name: "verbose", type: "boolean", short: "v" })
	.action(({ flags, stdout }) => stdout(flags.verbose ? "hello!" : "hello"))
	.command("wave", (command) => command.action(({ stdout }) => stdout("o/")));

await app.execute();
```

Inline `.command()` defines app-local leaf subcommands; extract to `defineCommand` when a command needs its own file, reuse, or a package. Commands declare Context demand with `.use(factory)` and applications supply values with `.provide(instance)`.

```ts
import { Crust, defineCommand, defineContext } from "@crustjs/core";

const logger = defineContext("logger", () => ({ write: console.error }));

const greet = defineCommand("greet", (command) =>
	command.use(logger).action(async ({ ctx, stdout }) => {
		(await ctx.logger).write("greeting");
		stdout("hello");
	}),
);

await new Crust("my-cli").provide(logger()).add(greet).execute();
```

The package root contains invocation-time authoring and execution APIs. Import build- and render-time helpers such as `buildCommandDocumentation`, `isListed`, `sectionsFor`, and `visibleSectionsFor` from `@crustjs/core/tooling`.

## Documentation

Full docs: [crustjs.com/docs/modules/core](https://crustjs.com/docs/modules/core)
