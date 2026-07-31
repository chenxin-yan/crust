# @crustjs/prompts

Interactive terminal prompts for the Crust CLI ecosystem.

## Install

```sh
bun add @crustjs/prompts
```

## Injectable IO

All prompt functions accept an optional `io` argument with `input` and `output` streams. Prompt UI writes to the resolved output stream — stderr by default — while allowing applications and tests to provide their own streams.

```ts
import { input, withPromptIO, type PromptIO } from "@crustjs/prompts";

declare const io: PromptIO;

const name = await input({ message: "Name?" }, io);
const scopedName = await withPromptIO(io, () => input({ message: "Name?" }));
```

## Testing Custom Prompts

`@crustjs/prompts/testing` drives prompt functions against fake TTY streams:

```ts
import { expect, test } from "bun:test";
import { renderPrompt } from "@crustjs/prompts/testing";

import { myPrompt } from "./my-prompt.ts";

test("submits a value", async () => {
	const prompt = renderPrompt(myPrompt, { message: "Name?" });
	prompt.type("Ada");
	prompt.keys("return");

	expect(await prompt.answer).toBe("Ada");
});
```

Prompt functions passed to `renderPrompt` accept `(options, io?)`. Use `createPromptIO({ isTTY: false })` when testing non-interactive default fallbacks.

## Documentation

Full docs: [crustjs.com/docs/modules/prompts](https://crustjs.com/docs/modules/prompts)
