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
| `autoCompletePlugin(options?)` | Suggests similar command names when users mistype a command |
| `completionPlugin(options?)` | Adds `completion <shell>` commands for Bash, Zsh, and Fish |
| `updateNotifierPlugin(options)` | Checks npm for newer versions and displays an update notice |

## Usage

```ts
import { defineCommand, runMain } from "@crustjs/core";
import {
  autoCompletePlugin,
  completionPlugin,
  helpPlugin,
  versionPlugin,
} from "@crustjs/plugins";

const main = defineCommand({
  meta: { name: "my-cli", description: "My CLI tool" },
  run() {
    console.log("Hello!");
  },
});

runMain(main, {
  plugins: [
    versionPlugin("1.0.0"),
    autoCompletePlugin(),
    completionPlugin(),
    helpPlugin(),
  ],
});
```

### Shell Completion

The `completionPlugin` injects a visible `completion` command that prints shell scripts for `bash`, `zsh`, and `fish`.

Register it before `helpPlugin()` if you want the injected `completion` command tree to inherit `--help`.

```ts
import { Crust } from "@crustjs/core";
import {
  completeArg,
  completeFlag,
  completionPlugin,
  helpPlugin,
} from "@crustjs/plugins";

const app = new Crust("my-cli")
  .flags({
    format: completeFlag(
      { type: "string", description: "Output format" },
      ["json", "yaml"],
    ),
  })
  .command("deploy", (cmd) =>
    cmd
      .args([
        completeArg(
          { name: "env", type: "string", description: "Target environment" },
          ["dev", "staging", "prod"],
        ),
      ] as const)
      .run(() => {}),
  )
  .use(completionPlugin())
  .use(helpPlugin());

await app.execute();
```

Examples:

```sh
my-cli completion bash
my-cli completion zsh
my-cli completion fish
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
- **Package-manager-aware command** — The upgrade hint is inferred from `npm_config_user_agent` by default and can be overridden.

#### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `currentVersion` | `string` | *(required)* | The current version of your CLI package. |
| `packageName` | `string` | *(required)* | The npm package name to check for updates. |
| `timeoutMs` | `number` | `5_000` (5s) | Network request timeout. Aborted checks are treated as soft failures. |
| `registryUrl` | `string` | `"https://registry.npmjs.org"` | Custom npm registry URL. |
| `packageManager` | `"auto" \| "npm" \| "pnpm" \| "yarn" \| "bun"` | `"auto"` | Package manager used when building the default update command. |
| `updateCommand` | `string \| ((packageName, packageManager) => string)` | inferred | Override the command shown in the update notice (for example Homebrew). |
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

> **Note:** Version comparison uses standard semver (`major.minor.patch`). Prerelease suffixes are stripped before comparison — `1.2.3-beta.1` is treated as `1.2.3`.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
