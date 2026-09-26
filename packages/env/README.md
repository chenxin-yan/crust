# @crustjs/env

Typed, validated environment variables as a Crust Context, documented in help and man pages.

```ts
import { defineEnv } from "@crustjs/env";

const env = defineEnv("env", {
	DATABASE_URL: { type: "url", required: true, description: "Postgres connection" },
	PORT: { type: "number", default: 3000 },
});

app.provide(env());

// in an action
const { DATABASE_URL, PORT } = await ctx.env; // URL, number
```

Missing or invalid variables reject with one `CrustError("ENV")` listing each variable by name, never its value.

## Install

```sh
bun add @crustjs/env
```

## Documentation

Full docs: [crustjs.com/docs/modules/env](https://crustjs.com/docs/modules/env)
