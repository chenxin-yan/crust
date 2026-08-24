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
	.action(({ flags, stdout }) => stdout(flags.verbose ? "hello!" : "hello"));

await app.execute();
```

The package root contains invocation-time authoring and execution APIs. Import build- and render-time helpers such as `buildCommandDocumentation`, `isListed`, `sectionsFor`, and `visibleSectionsFor` from `@crustjs/core/tooling`.

## Documentation

Full docs: [crustjs.com/docs/modules/core](https://crustjs.com/docs/modules/core)
