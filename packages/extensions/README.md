# @crustjs/extensions

Official Extensions for the Crust CLI framework

## Install

```sh
bun add @crustjs/extensions
```

## Usage

```ts
import { Crust } from "@crustjs/core";
import {
	completion,
	didYouMean,
	help,
	noColor,
	updateNotifier,
	version,
} from "@crustjs/extensions";
import pkg from "../package.json";

const app = new Crust("my-cli", { version: pkg.version })
	.extend(
		help(),
		version(),
		didYouMean(),
		noColor(),
		completion(),
		updateNotifier({ packageName: pkg.name }),
	)
	.action(({ stdout }) => stdout("Hello"));

await app.execute();
```

## Exports

Curated exports, all imported from `@crustjs/extensions`:

- Extension factories: `help`, `version`, `completion`, `didYouMean`, `noColor`, `updateNotifier`.
- Command Snapshot renderers: `renderHelp`, `renderBashCompletion`, `renderZshCompletion`, `renderFishCompletion`.

## Documentation

Full docs: [crustjs.com/docs/modules/extensions](https://crustjs.com/docs/modules/extensions)
