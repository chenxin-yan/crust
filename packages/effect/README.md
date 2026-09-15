# @crustjs/effect

Effect.ts v4 adaptor for Crust: write Command Actions and Contexts as Effects while Crust stays the runtime.

## Install

```sh
bun add @crustjs/effect@next effect@4.0.0-rc.115
```

`effect` (4.x prerelease) and `@crustjs/core` are peer dependencies. Install the exact `effect` version this package was tested against; the adaptor is published under the `next` dist-tag.

## Quick example

```ts
import { Crust } from "@crustjs/core";
import { effectAction, effectContext } from "@crustjs/effect";
import { Context, Effect, Layer } from "effect";

class Db extends Context.Service<Db, { readonly query: (sql: string) => string }>()("app/Db") {}

const db = effectContext(
	"db",
	Layer.effect(
		Db,
		Effect.acquireRelease(
			Effect.sync(() => ({ query: (sql) => `rows for ${sql}` })),
			() => Effect.sync(() => console.log("closed")),
		),
	),
);

await new Crust("app")
	.provide(db())
	.args({ name: "table", type: "string", required: true })
	.action(
		effectAction([db], ({ args }) =>
			Effect.gen(function* () {
				const database = yield* Db;
				console.log(database.query(`select * from ${args.table}`));
			}),
		),
	)
	.execute();
```

## Documentation

Full docs: [crustjs.com/docs/modules/effect](https://crustjs.com/docs/modules/effect)
