# @crustjs/progress

Progress indicators for the [Crust](https://crustjs.com) CLI framework.

`@crustjs/progress` provides non-interactive terminal progress primitives for long-running tasks. It currently includes `spinner()`, with support for message updates, custom animations, theming, and non-TTY fallbacks.

Zero runtime dependencies beyond `@crustjs/style`.

## Install

```sh
bun add @crustjs/progress
```

## Quick Start

```ts
import { spinner } from "@crustjs/progress";

const result = await spinner({
  message: "Fetching data...",
  task: async ({ updateMessage }) => {
    await fetchStepOne();
    updateMessage("Processing...");
    await fetchStepTwo();
    return { ok: true };
  },
});
```

## Theme

`@crustjs/progress` exposes `createTheme`, `setTheme`, and `getTheme` for global progress styling.

```ts
import { createTheme, setTheme } from "@crustjs/progress";
import { cyan, green } from "@crustjs/style";

setTheme(
  createTheme({
    spinner: cyan,
    success: green,
  }),
);
```
