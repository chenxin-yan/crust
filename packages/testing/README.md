# @crustjs/testing

Typed testing helpers for Crust CLI applications.

## Install

```sh
bun add -d @crustjs/testing
```

## Quick example

```ts
import { captureRun } from "@crustjs/testing";

const result = await captureRun(app, ["build"], {
	args: { entry: "src/cli.ts" },
	flags: { minify: true },
});
```

Command paths, arguments, and flags are inferred from `app`. Use `captureExecute(app, argv)` for raw terminal syntax and Extension-contributed commands.

## Documentation

Full docs: [crustjs.com/docs/modules/testing](https://crustjs.com/docs/modules/testing)
