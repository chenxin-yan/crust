# @crustjs/man

Generate mdoc(7) manual pages from Crust CLI definitions

## Install

```sh
bun add -d @crustjs/man
```

## Build Extension

```ts
import { Crust } from "@crustjs/core";
import { man } from "@crustjs/man";

const app = new Crust("my-cli").extend(man());
```

`crust build` runs the Extension hook and writes `man/my-cli.1` under the build output. Use `man({ section: 5 })` for another section. `writeManPage()` remains available for custom pipelines.

## Documentation

Full docs: [crustjs.com/docs/modules/man](https://crustjs.com/docs/modules/man)
