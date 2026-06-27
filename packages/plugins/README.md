# @crustjs/plugins

Official plugins for the [Crust](https://crustjs.com) CLI framework.

## Install

```sh
bun add @crustjs/plugins
```

## Extensions

| Extension                 | Description                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `help()`                  | Adds `--help` / `-h` flag and auto-generates help text                                                                                                                                                      |
| `noColor()`               | Adds `--color` / `--no-color` and controls runtime color output                                                                                                                                             |
| `version(version)`        | Adds `--version` / `-v` flag                                                                                                                                                                                |
| `didYouMean(options?)`    | Suggests corrections for mistyped subcommands via Levenshtein matching                                                                                                                                      |
| `updateNotifier(options)` | Checks npm for newer versions and displays an update notice                                                                                                                                                 |
| `completion(options?)`    | Adds a `completion <shell>` subcommand that emits bash/zsh/fish tab-completion scripts. `path` flags/args emit file-completion candidates; `url` and `json` flags/args explicitly suppress file completion. |

## Usage

```ts
import { Crust } from "@crustjs/core";
import { didYouMean, help, version } from "@crustjs/plugins";

const main = new Crust("my-cli")
	.meta({ description: "My CLI tool" })
	.extend(version("1.0.0"), didYouMean(), help())
	.run(() => {
		console.log("Hello!");
	});

await main.execute();
```

For **manual pages** (mdoc), use [`@crustjs/man`](https://www.npmjs.com/package/@crustjs/man) or `crust build --man` — see [Man](/docs/modules/man).

### No Color

The `noColor()` extension adds a root `color` boolean flag with default `true`, exposing `--color` and `--no-color`.

It follows [no-color.org](https://no-color.org/):

- `--no-color` disables color output for the current run
- `--color` overrides `NO_COLOR=1` for the current run
- Only color is disabled; non-color modifiers such as bold remain available

Register `noColor()` before extensions that may render output, such as `help()`.

```ts
import { Crust } from "@crustjs/core";
import { help, noColor, version } from "@crustjs/plugins";

const app = new Crust("my-cli").extend(noColor(), version("1.0.0"), help()).run(() => {
	console.log("Hello!");
});
```

### Update Notifier

The `updateNotifier` extension checks the npm registry for newer versions of your package and displays a notice after command execution when an update is available.

```ts
import { Crust } from "@crustjs/core";
import { updateNotifier } from "@crustjs/plugins";
import pkg from "../package.json";

const main = new Crust("my-cli")
	.meta({ description: "My CLI tool" })
	.extend(updateNotifier({ packageName: pkg.name, currentVersion: pkg.version }))
	.run(() => {
		console.log("Hello!");
	});

await main.execute();
```

You are responsible for passing `packageName` and `currentVersion` — typically sourced from your `package.json`.

#### Behavior

- **No persistence by default** — Out of the box, the plugin does not persist notifier state across runs.
- **Optional cache adapter** — If you provide `cache`, checks are reused up to `cache.intervalMs` (default 24h) and notifications are deduped across runs.
- **Non-blocking** — The update check runs after your command handler completes. It never delays command execution.
- **Soft failure** — All internal errors (network timeouts, registry failures, cache errors, malformed responses) are silently swallowed. The plugin never affects exit codes or command output.
- **Stderr output** — The update notice is written to stderr so it does not interfere with piped stdout.
- **Package-manager-aware command** — The upgrade hint is inferred from the runtime environment by default and can be overridden.
- **Scope-aware command** — The notifier also infers local vs global installs with best-effort heuristics. Use `installScope` or `updateCommand` when you need exact control.

#### Options

| Option           | Type                                                                | Default                        | Description                                                                                                                               |
| ---------------- | ------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `currentVersion` | `string`                                                            | _(required)_                   | The current version of your CLI package.                                                                                                  |
| `packageName`    | `string`                                                            | _(required)_                   | The npm package name to check for updates.                                                                                                |
| `timeoutMs`      | `number`                                                            | `5_000` (5s)                   | Network request timeout. Aborted checks are treated as soft failures.                                                                     |
| `registryUrl`    | `string`                                                            | `"https://registry.npmjs.org"` | Custom npm registry URL.                                                                                                                  |
| `packageManager` | `"auto" \| "npm" \| "pnpm" \| "yarn" \| "bun"`                      | `"auto"`                       | Package manager used when building the default update command.                                                                            |
| `installScope`   | `"auto" \| "local" \| "global"`                                     | `"auto"`                       | Install scope used when building the default update command.                                                                              |
| `updateCommand`  | `string \| ((packageName, packageManager, installScope) => string)` | inferred                       | Override the command shown in the update notice. Recommended for unusual distribution channels or when runtime inference is insufficient. |
| `cache`          | `{ adapter, intervalMs? }`                                          | none                           | Optional cache configuration for cross-run persistence and dedupe.                                                                        |

#### Optional persistence with `@crustjs/store`

If you want cross-run cache behavior without forcing `@crustjs/store` as a dependency, pass a cache config with an adapter:

```ts
import { stateDir, createStore } from "@crustjs/store";
import { updateNotifier } from "@crustjs/plugins";

const store = createStore({
	dirPath: stateDir("my-cli"), // Replace with your package name
	name: "update-notifier",
	fields: {
		lastCheckedAt: { type: "number", default: 0 },
		latestVersion: { type: "string" },
		lastNotifiedVersion: { type: "string" },
	},
});

updateNotifier({
	packageName: "my-cli",
	currentVersion: "1.0.0",
	cache: { adapter: store },
});
```

For a globally installed Bun CLI, you can set the scope directly:

```ts
updateNotifier({
	packageName: "my-cli",
	currentVersion: "1.0.0",
	packageManager: "bun",
	installScope: "global",
});
```

Or provide an explicit command:

```ts
updateNotifier({
	packageName: "my-cli",
	currentVersion: "1.0.0",
	updateCommand: "bun add -g my-cli@latest",
});
```

> **Note:** Version comparison uses standard semver (`major.minor.patch`). Prerelease suffixes are stripped before comparison — `1.2.3-beta.1` is treated as `1.2.3`.

### Completion

The `completion()` extension adds a `completion <shell>` subcommand that emits a self-contained tab-completion script for **bash**, **zsh**, or **fish**.

```ts
import { Crust } from "@crustjs/core";
import { completion } from "@crustjs/plugins";
import pkg from "../package.json";

const app = new Crust("my-cli")
	.extend(completion({ version: pkg.version }))
	.command("build", (cmd) =>
		cmd
			.meta({ description: "Build artifact" })
			.flags({ target: { type: "string", choices: ["browser", "bun", "node"] } })
			.run(() => {}),
	)
	.run(() => {});

await app.execute();
```

```sh
# Print to stdout (one shell at a time)
my-cli completion bash > ~/.local/share/bash-completion/completions/my-cli
# Or write all configured shells in one go (packaging-time)
my-cli completion bash --output-dir completions/
```

See [the completion guide](https://crustjs.com/docs/modules/plugins/completion) for per-shell install paths, packaging recipes, and the v1 limitations (notably the strict identifier/choice-value validation).

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
