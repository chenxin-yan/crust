# @crustjs/extensions

Official Extensions for the Crust CLI framework

## Install

```sh
bun add @crustjs/extensions
```

## Usage

```ts
import { Crust } from "@crustjs/core";
import { completion, help } from "@crustjs/extensions";

const app = new Crust("my-cli", { version: "1.2.3" })
	.extend(help(), completion())
	.action(({ stdout }) => stdout("Hello"));

await app.execute();
```

For manual setup, source the installed application's generated script in your
shell configuration. See [quick shell setup](https://crustjs.com/docs/modules/extensions/completion#quick-shell-setup)
for Bash, Zsh, and Fish commands and prerequisites. If package-managed completion
already works, do not add a second loading method.

For packaging, `crust build` generates all three shell files in
`<outdir>/completions/`; `crust build --package` stages them in the npm packages.
These artifacts do not activate completion automatically.

## Exports

Import all exports from `@crustjs/extensions`:

- `help()`, `renderHelp()` — help flags and snapshot-based help rendering.
- `version()` — root version flag.
- `completion()` — shell completion command and build artifacts.
- `renderBashCompletion()`, `renderZshCompletion()`, `renderFishCompletion()` —
  pure renderers returning scripts from a root Command Snapshot.
- `didYouMean()` — suggestions for unknown commands.
- `noColor()` — color control flags.
- `updateNotifier()` — npm update notices.

Completion types: `CompletionOptions`, `CompletionShell`, and
`CompletionRenderOptions` (the renderers' optional `binName` and `version` overrides).

```ts
import { Crust } from "@crustjs/core";
import {
	type CompletionRenderOptions,
	renderBashCompletion,
	renderFishCompletion,
	renderZshCompletion,
} from "@crustjs/extensions";

const app = new Crust("my-cli", { version: "1.2.3" });
const snapshot = await app.snapshot();
const options: CompletionRenderOptions = { binName: "installed-name" };
const bash = renderBashCompletion(snapshot, options);
const zsh = renderZshCompletion(snapshot, options);
const fish = renderFishCompletion(snapshot, options);
```

Renderers do not write files. Runtime output, build artifacts, and pure renderers
use the root version unless overridden; omitting both versions throws.
See the [completion reference](https://crustjs.com/docs/modules/extensions/completion)
for filenames, installation, and build behavior.

## Documentation

Full docs: [crustjs.com/docs/modules/extensions](https://crustjs.com/docs/modules/extensions)
