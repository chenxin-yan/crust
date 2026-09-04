# @crustjs/style

Terminal styling foundation for the Crust CLI framework

## Install

```sh
bun add @crustjs/style
```

## Quick example

```ts
import { createStyle, fg, table } from "@crustjs/style";

console.log(fg("brand", "#4fa83d"));
console.log(table(["Name", "Age"], [["Ada", "36"]], { align: ["left", "right"] }));

const deterministic = createStyle({
	mode: "auto",
	overrides: { isTTY: true, forceColor: "3" },
});
console.log(deterministic.fg("snapshot", "#4fa83d"));
```

`fg` and `bg` use the active style capabilities. Use `createStyle({ overrides })` when output must be deterministic.

## Documentation

Full docs: [crustjs.com/docs/modules/style](https://crustjs.com/docs/modules/style)
