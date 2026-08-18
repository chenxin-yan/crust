# @crustjs/utils

Internal shared utilities for Crust workspace packages.

## Ambient terminal IO

`@crustjs/utils/terminal` provides the line-oriented output scope shared by Core, Prompts, and Progress:

```ts
import { getAmbientTerminalIO, withAmbientTerminalIO } from "@crustjs/utils/terminal";

await withAmbientTerminalIO(
	{
		stdout: (text) => console.log(text),
		stderr: (text) => console.error(text),
	},
	async () => {
		getAmbientTerminalIO()?.stderr("captured by the current invocation");
	},
);
```

Core creates this scope only when invocation IO is explicitly injected. It is line-oriented output only; interactive prompt input remains part of `PromptIO`.
