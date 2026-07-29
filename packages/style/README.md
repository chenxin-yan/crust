# @crustjs/style

Terminal styling foundation for the Crust CLI framework

## Install

```sh
bun add @crustjs/style
```

## Usage

```ts
import { applyStyle, bold, composeStyles, fgCode, red } from "@crustjs/style";

console.log(bold.red("critical error"));
console.log(applyStyle("brand", composeStyles(bold, red, fgCode("#4fa83d"))));
```

Color and modifier chainables are also `AnsiPair` values, so they compose directly. `fgCode`,
`bgCode`, and `linkCode` create dynamic pairs.

## Documentation

Full docs: [crustjs.com/docs/modules/style](https://crustjs.com/docs/modules/style)
