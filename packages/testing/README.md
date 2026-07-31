# @crustjs/testing

Testing helpers for Crust CLI applications

## Install

```sh
bun add -d @crustjs/testing
```

## Exports

- `captureRun(app, argv)` — run an application with captured output. Each `ctx.stdout()`/`ctx.stderr()` call is one line, joined with `"\n"`; a thrown application error is returned as `error` instead of discarding earlier output.
- `interactiveRun(app, argv)` — run an application against a fake TTY for handlers that render built-in prompts: `waitFor(pattern, timeoutMs?)`, `type(text)`, `keys(...names)`, `screen()`, and `done`.

## Quick example

```ts
import { expect, test } from "bun:test";
import { captureRun, interactiveRun } from "@crustjs/testing";

import { app } from "./cli.ts";

test("greets a name", async () => {
	const result = await captureRun(app, ["Ada"]);
	expect(result.stdout).toBe("Hello, Ada!");
});

test("prompts for a name", async () => {
	const run = interactiveRun(app, []);
	await run.waitFor(/Name\?/);
	run.type("Ada");
	run.keys("return");
	await run.done;
	expect(run.screen()).toContain("Hello, Ada!");
});
```

Testing a custom `(options, io?)` prompt? Use `renderPrompt()` from `@crustjs/prompts/testing` — built-in prompts are already covered by the library.

## Documentation

Full docs: [crustjs.com/docs/modules/testing](https://crustjs.com/docs/modules/testing)
