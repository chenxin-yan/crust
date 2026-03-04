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
    updateNotifierPlugin({ currentVersion: pkg.version }),
  ],
});
```

You are responsible for passing `currentVersion` — typically sourced from your `package.json`.

To override the package name used for registry lookups (for example, when it differs from the command name):

```ts
updateNotifierPlugin({
  currentVersion: pkg.version,
  packageName: "@my-org/my-cli",
});
```

#### Behavior

- **No persistence by default** — Out of the box, the plugin does not persist notifier state across runs.
- **Optional cache adapter** — If you provide `cache`, checks are reused up to `intervalMs` (default 24h) and notifications are deduped across runs.
- **Non-blocking** — The update check runs after your command handler completes. It never delays command execution.
- **Soft failure** — All internal errors (network timeouts, registry failures, cache errors, malformed responses) are silently swallowed. The plugin never affects exit codes or command output.
- **Stderr output** — The update notice is written to stderr so it does not interfere with piped stdout.
- **Package-manager-aware command** — The upgrade hint is inferred from `npm_config_user_agent` by default and can be overridden.

#### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `currentVersion` | `string` | *(required)* | The current version of your CLI package. |
| `packageName` | `string` | Root command `meta.name` | The npm package name to check. |
| `intervalMs` | `number` | `86_400_000` (24h) | Minimum interval in milliseconds between network checks. |
| `enabled` | `boolean` | `true` | Set to `false` to disable all check and notification behavior. |
| `timeoutMs` | `number` | `5_000` (5s) | Network request timeout. Aborted checks are treated as soft failures. |
| `registryUrl` | `string` | `"https://registry.npmjs.org"` | Custom npm registry URL. |
| `packageManager` | `"auto" \| "npm" \| "pnpm" \| "yarn" \| "bun"` | `"auto"` | Package manager used when building the default update command. |
| `updateCommand` | `string \| ((packageName, packageManager) => string)` | inferred | Override the command shown in the update notice (for example Homebrew). |
| `cache` | `{ read, write }` | none | Optional persistence adapter for cross-run cache/dedupe behavior. |

#### Optional persistence with `@crustjs/store`

If you want cross-run cache behavior without forcing `@crustjs/store` as a dependency, pass an adapter:

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
  currentVersion: "1.0.0",
  cache: store,
});
```

> **Note:** Version comparison uses standard semver (`major.minor.patch`). Prerelease suffixes are stripped before comparison — `1.2.3-beta.1` is treated as `1.2.3`.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
