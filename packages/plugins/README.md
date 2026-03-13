# @crustjs/plugins

Official plugins for the [Crust](https://crustjs.com) CLI framework.

## Install

```sh
bun add @crustjs/plugins
```

## Plugins

| Plugin | Description |
| --- | --- |
| `helpPlugin()` | Adds `--help` / `-h` flag and auto-generates help text |
| `versionPlugin(version)` | Adds `--version` / `-v` flag |
| `autoCompletePlugin(options?)` | Shell autocompletion support |
| `updateNotifierPlugin(options)` | Checks npm for newer versions and displays an update notice |

## Usage

```ts
import { defineCommand, runMain } from "@crustjs/core";
import { helpPlugin, versionPlugin, autoCompletePlugin } from "@crustjs/plugins";

const main = defineCommand({
  meta: { name: "my-cli", description: "My CLI tool" },
  run() {
    console.log("Hello!");
  },
});

runMain(main, {
  plugins: [versionPlugin("1.0.0"), autoCompletePlugin(), helpPlugin()],
});
```

### Update Notifier

The `updateNotifierPlugin` checks the npm registry for newer versions of your package and displays a notice after command execution when an update is available.

```ts
import { defineCommand, runMain } from "@crustjs/core";
import { updateNotifierPlugin } from "@crustjs/plugins";
import pkg from "../package.json";

const main = defineCommand({
  meta: { name: "my-cli", description: "My CLI tool" },
  run() {
    console.log("Hello!");
  },
});

runMain(main, {
  plugins: [
    updateNotifierPlugin({ packageName: pkg.name, currentVersion: pkg.version }),
  ],
});
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

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `currentVersion` | `string` | *(required)* | The current version of your CLI package. |
| `packageName` | `string` | *(required)* | The npm package name to check for updates. |
| `timeoutMs` | `number` | `5_000` (5s) | Network request timeout. Aborted checks are treated as soft failures. |
| `registryUrl` | `string` | `"https://registry.npmjs.org"` | Custom npm registry URL. |
| `packageManager` | `"auto" \| "npm" \| "pnpm" \| "yarn" \| "bun"` | `"auto"` | Package manager used when building the default update command. |
| `installScope` | `"auto" \| "local" \| "global"` | `"auto"` | Install scope used when building the default update command. |
| `updateCommand` | `string \| ((packageName, packageManager, installScope) => string)` | inferred | Override the command shown in the update notice. Recommended for unusual distribution channels or when runtime inference is insufficient. |
| `cache` | `{ adapter, intervalMs? }` | none | Optional cache configuration for cross-run persistence and dedupe. |

#### Optional persistence with `@crustjs/store`

If you want cross-run cache behavior without forcing `@crustjs/store` as a dependency, pass a cache config with an adapter:

```ts
import { stateDir, createStore } from "@crustjs/store";
import { updateNotifierPlugin } from "@crustjs/plugins";

const store = createStore({
  dirPath: stateDir("my-cli"), // Replace with your package name
  name: "update-notifier",
  fields: {
    lastCheckedAt: { type: "number", default: 0 },
    latestVersion: { type: "string" },
    lastNotifiedVersion: { type: "string" },
  },
});

updateNotifierPlugin({
  packageName: "my-cli",
  currentVersion: "1.0.0",
  cache: { adapter: store },
});
```

For a globally installed Bun CLI, you can now set the scope directly:

```ts
updateNotifierPlugin({
  packageName: "my-cli",
  currentVersion: "1.0.0",
  packageManager: "bun",
  installScope: "global",
});
```

Or provide an explicit command:

```ts
updateNotifierPlugin({
  packageName: "my-cli",
  currentVersion: "1.0.0",
  updateCommand: "bun add -g my-cli@latest",
});
```

> **Note:** Version comparison uses standard semver (`major.minor.patch`). Prerelease suffixes are stripped before comparison — `1.2.3-beta.1` is treated as `1.2.3`.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
