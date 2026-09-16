# @crustjs/effect

Effect.ts v4 adaptor for Crust: write Command Actions and Contexts in Effect idiom while Crust stays the runtime.

## Install

```sh
bun add @crustjs/effect@next effect@4.0.0-rc.115
```

`effect` (4.x prerelease) and `@crustjs/core` are peer dependencies. Install the exact `effect` version this package was tested against; the adaptor is published under the `next` dist-tag.

## Quick example

```ts
import { Crust, defineContext } from "@crustjs/core";
import { handler, layer, service } from "@crustjs/effect";
import { Context, Effect, Layer } from "effect";

class Db extends Context.Service<Db, { readonly query: (sql: string) => string }>()("app/Db") {}

const db = layer(
	"db",
	Layer.effect(
		Db,
		Effect.acquireRelease(
			Effect.sync(() => ({ query: (sql) => `rows for ${sql}` })),
			() => Effect.sync(() => console.log("closed")),
		),
	),
);
const config = defineContext("config", () => ({ limit: 10 }));

await new Crust("app")
	.provide(db(), config())
	.args({ name: "table", type: "string", required: true })
	.action(
		handler(function* ({ args }) {
			const d = yield* Db;
			const cfg = yield* service(config);
			console.log(d.query(`select * from ${args.table} limit ${cfg.limit}`));
		}),
	)
	.execute();
```

Every `layer()` on the command path is built when the handler starts and released by Crust's cleanup; plain Contexts stay lazy. If `layer`/`handler` clash with names in your module, use `import * as CrustEffect from "@crustjs/effect"`.

## Documentation

Full docs: [crustjs.com/docs/modules/effect](https://crustjs.com/docs/modules/effect)
