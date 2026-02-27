# @crustjs/store

DX-first, typed persistence for CLI apps with clear config/data/state/cache separation.

`@crustjs/store` gives your CLI production-ready local persistence with near-zero setup. Provide a defaults object, pick a storage intent, and get a typed store with read/write/update/patch/reset — no manual type annotations needed.

## Install

```sh
# bun
bun add @crustjs/store

# npm
npm install @crustjs/store

# pnpm
pnpm add @crustjs/store
```

**Requirements:** Bun 1.x or Node 18+. TypeScript 5.x recommended.

## Quick Start

```ts
import { createStore, configDir } from "@crustjs/store";

const store = createStore({
  dirPath: configDir("my-cli"),
  defaults: {
    ui: { theme: "light" as string, fontSize: 14 },
    verbose: false,
  },
});

// Read state (returns defaults when no persisted file exists)
const state = await store.read();
// → { ui: { theme: "light", fontSize: 14 }, verbose: false }

// Write a full state object
await store.write({ ui: { theme: "dark", fontSize: 16 }, verbose: true });

// Update with a function
await store.update((current) => ({ ...current, verbose: false }));

// Patch only specific nested keys
await store.patch({ ui: { theme: "solarized" } });

// Reset to defaults (removes persisted file)
await store.reset();
```

No explicit generics needed — types are inferred from your `defaults` object.

## Storage Intent: Choosing a Directory

`@crustjs/store` provides four path helpers that resolve platform-standard directories for different storage intents. Use the one that matches what you're persisting:

| Helper      | Intent                     | Example Use Case                        |
| ----------- | -------------------------- | --------------------------------------- |
| `configDir` | User preferences & config  | Theme, editor settings, API keys        |
| `dataDir`   | Important app data         | Local databases, downloaded resources   |
| `stateDir`  | Runtime state              | Window positions, scroll offsets, undo  |
| `cacheDir`  | Regenerable cached data    | HTTP caches, compiled assets            |

```ts
import { createStore, configDir, dataDir, stateDir, cacheDir } from "@crustjs/store";

// User preferences → ~/.config/my-cli/config.json
const config = createStore({
  dirPath: configDir("my-cli"),
  defaults: { theme: "light" as string, verbose: false },
});

// App data → ~/.local/share/my-cli/config.json
const data = createStore({
  dirPath: dataDir("my-cli"),
  defaults: { bookmarks: [] as string[] },
});

// Runtime state → ~/.local/state/my-cli/config.json
const state = createStore({
  dirPath: stateDir("my-cli"),
  defaults: { lastOpened: "" as string, scrollY: 0 },
});

// Cache → ~/.cache/my-cli/config.json
const cache = createStore({
  dirPath: cacheDir("my-cli"),
  defaults: { etag: "" as string, payload: "" as string },
});
```

### Platform Paths

All four helpers follow XDG conventions on Linux and macOS, and Windows-native conventions on Windows:

| Helper      | Linux / macOS                       | Windows                                     | Env Override         |
| ----------- | ----------------------------------- | ------------------------------------------- | -------------------- |
| `configDir` | `~/.config/<app>`                   | `%APPDATA%\<app>`                           | `$XDG_CONFIG_HOME`   |
| `dataDir`   | `~/.local/share/<app>`              | `%LOCALAPPDATA%\<app>\Data`                 | `$XDG_DATA_HOME`     |
| `stateDir`  | `~/.local/state/<app>`              | `%LOCALAPPDATA%\<app>\State`                | `$XDG_STATE_HOME`    |
| `cacheDir`  | `~/.cache/<app>`                    | `%LOCALAPPDATA%\<app>\Cache`                | `$XDG_CACHE_HOME`    |

macOS uses XDG conventions (same as Linux) for a unified Unix mental model.

## API

### `createStore(options)`

Creates a typed async store backed by a local JSON file. The file path is resolved once at creation time.

```ts
const store = createStore(options);
```

**Returns:** A `Store<T>` with `read()`, `write()`, `update()`, `patch()`, and `reset()` methods.

**Throws:** `CrustStoreError` with `PATH` code if `dirPath` or `name` is invalid.

#### Options

| Option         | Type                       | Required | Description                                                        |
| -------------- | -------------------------- | -------- | ------------------------------------------------------------------ |
| `dirPath`      | `string`                   | Yes      | Absolute directory path where the JSON file is stored.             |
| `name`         | `string`                   | No       | Store name used as filename (default `"config"` → `config.json`).  |
| `defaults`     | `T`                        | Yes      | Default values defining the store's data shape and fallbacks.      |
| `validate`     | `(state: T) => void`       | No       | Validation function called before `write`, `update`, and `patch`.  |
| `pruneUnknown` | `boolean`                  | No       | Drop unknown persisted keys on read (default `true`).              |

### `store.read()`

Reads the persisted state file. Missing keys are filled from `defaults` via deep merge. When no file exists, returns `defaults`.

```ts
const state = await store.read();
```

Always returns a value — never `undefined`. Does not write merged defaults back to disk.

### `store.write(state)`

Atomically persists a full state object. The entire previous state is replaced.

```ts
await store.write({ ui: { theme: "dark", fontSize: 14 }, verbose: true });
```

Calls `validate` (if provided) before writing. Parent directories are created if missing.

### `store.update(updater)`

Reads the current effective state, applies the updater function, and atomically persists the result.

```ts
await store.update((current) => ({
  ...current,
  ui: { ...current.ui, theme: "dark" },
}));
```

When no persisted file exists, the updater receives `defaults` as the current value. Calls `validate` before writing.

### `store.patch(partial)`

Applies a deep partial update to the current state and persists. Only the provided keys are updated; everything else is preserved.

```ts
await store.patch({ ui: { theme: "solarized" } });
```

Arrays are replaced wholesale (not merged element-by-element). Calls `validate` before writing.

### `store.reset()`

Removes the persisted state file. After reset, `read()` returns `defaults`.

```ts
await store.reset();
```

Reset is idempotent — calling it when no file exists is a no-op.

### Path Helpers

#### `configDir(appName, env?)`

Resolves the platform-standard config directory for the given app name.

```ts
import { configDir } from "@crustjs/store";

const dir = configDir("my-cli");
// → "/home/user/.config/my-cli"       (Linux / macOS)
// → "C:\\Users\\user\\AppData\\Roaming\\my-cli"       (Windows)
```

#### `dataDir(appName, env?)`

Resolves the platform-standard data directory.

```ts
import { dataDir } from "@crustjs/store";

const dir = dataDir("my-cli");
// → "/home/user/.local/share/my-cli"   (Linux / macOS)
// → "C:\\Users\\user\\AppData\\Local\\my-cli\\Data"    (Windows)
```

#### `stateDir(appName, env?)`

Resolves the platform-standard state directory.

```ts
import { stateDir } from "@crustjs/store";

const dir = stateDir("my-cli");
// → "/home/user/.local/state/my-cli"   (Linux / macOS)
// → "C:\\Users\\user\\AppData\\Local\\my-cli\\State"   (Windows)
```

#### `cacheDir(appName, env?)`

Resolves the platform-standard cache directory.

```ts
import { cacheDir } from "@crustjs/store";

const dir = cacheDir("my-cli");
// → "/home/user/.cache/my-cli"         (Linux / macOS)
// → "C:\\Users\\user\\AppData\\Local\\my-cli\\Cache"   (Windows)
```

All path helpers accept an optional `PlatformEnv` parameter for deterministic testing without mutating `process.env`.

## Multiple Stores

Use the `name` option to create multiple stores under the same directory:

```ts
import { createStore, configDir } from "@crustjs/store";

const dir = configDir("my-cli");

// Default store → ~/.config/my-cli/config.json
const settingsStore = createStore({
  dirPath: dir,
  defaults: {
    ui: { theme: "light" as string, fontSize: 14 },
    verbose: false,
  },
});

// Auth store → ~/.config/my-cli/auth.json
const authStore = createStore({
  dirPath: dir,
  name: "auth",
  defaults: { token: "" as string },
});
```

Each store is fully independent — reading, writing, updating, and resetting one store does not affect the others.

The `name` must not contain path separators or the `.json` extension.

## Defaults & Merge

When a persisted file exists, `read()` deep-merges defaults for any missing keys:

```ts
const store = createStore({
  dirPath: configDir("my-cli"),
  defaults: {
    ui: { theme: "light", fontSize: 14 },
    verbose: false,
  },
});

// Persisted file contains: { "ui": { "theme": "dark" }, "verbose": true }
const state = await store.read();
// → { ui: { theme: "dark", fontSize: 14 }, verbose: true }
```

### Merge Rules

- Persisted values override defaults at every nesting level.
- Missing keys fall back to defaults (recursively for nested objects).
- Arrays are replaced wholesale — not merged element-by-element.
- Unknown persisted keys are dropped by default (`pruneUnknown: true`). Set `pruneUnknown: false` to preserve them.
- All values are deep-cloned to prevent shared-reference mutation from defaults.
- Falsy values (`null`, `0`, `""`, `false`) in the persisted file are preserved — only truly missing keys trigger defaults.

### Important: defaults are not auto-persisted

Merged defaults exist only in memory. The persisted file remains unchanged until you explicitly call `write()`, `update()`, or `patch()`.

## Validation

Add a `validate` function to check state before it's written to disk:

```ts
const store = createStore({
  dirPath: configDir("my-cli"),
  defaults: { port: 3000, host: "localhost" as string },
  validate(state) {
    if (state.port < 1 || state.port > 65535) {
      throw new Error("port must be between 1 and 65535");
    }
  },
});

// Throws CrustStoreError with VALIDATION code
await store.write({ port: 0, host: "localhost" });
```

`validate` is called on `write`, `update`, and `patch` — never on `read` or `reset`.

## Error Handling

All errors thrown by `@crustjs/store` are instances of `CrustStoreError` with a typed `code` property:

| Code         | When                                                    | Details                        |
| ------------ | ------------------------------------------------------- | ------------------------------ |
| `PATH`       | Invalid `dirPath`, invalid `name`, unsupported platform | `{ path: string }`            |
| `PARSE`      | Malformed JSON in persisted file                        | `{ path: string }`            |
| `IO`         | Filesystem read, write, or delete failure               | `{ path, operation }`         |
| `VALIDATION` | `validate` function rejected the state                  | `{ operation }`               |

### Catching errors by code

```ts
import { CrustStoreError } from "@crustjs/store";

try {
  const state = await store.read();
} catch (err) {
  if (err instanceof CrustStoreError) {
    switch (err.code) {
      case "PARSE":
        console.error(`Corrupt file at ${err.details.path}`);
        console.error("Delete the file and retry, or fix the JSON manually.");
        break;
      case "IO":
        console.error(`File ${err.details.operation} failed: ${err.message}`);
        break;
    }
  }
}
```

### Type narrowing with `.is()`

The `.is()` method narrows the error type so `details` is fully typed:

```ts
if (err instanceof CrustStoreError && err.is("IO")) {
  // err.details is { path: string; operation: "read" | "write" | "delete" }
  console.error(err.details.operation, err.details.path);
}
```

### Cause chaining

`CrustStoreError` preserves the original error as `cause` for debugging:

```ts
if (err instanceof CrustStoreError && err.is("VALIDATION")) {
  console.error("Validation error:", err.cause);
}
```

### Malformed JSON

`@crustjs/store` does **not** silently recover from malformed JSON. If the persisted file contains invalid JSON, `read()` throws a `CrustStoreError` with `PARSE` code immediately — no fallback to defaults.

## Types

All types are exported for use in your application:

```ts
import type {
  CreateStoreOptions,
  DeepPartial,
  Store,
  StoreUpdater,
  StoreErrorCode,
  PlatformEnv,
} from "@crustjs/store";
```

| Type                 | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| `CreateStoreOptions` | Options object for `createStore()`.                             |
| `DeepPartial`        | Recursive partial type for `patch()` arguments.                 |
| `Store`              | Store instance with `read`, `write`, `update`, `patch`, `reset`.|
| `StoreUpdater`       | Updater function type `(current: T) => T`.                      |
| `StoreErrorCode`     | Union of error codes: `"PATH" \| "PARSE" \| "IO" \| "VALIDATION"`. |
| `PlatformEnv`        | Injectable platform environment for testing path helpers.       |
| `CrustStoreError`    | Typed error class with `code`, `details`, and `cause`.          |

## Scope & Non-Goals

`@crustjs/store` is intentionally focused. The following are **not** included:

- **Cross-process locking** — assumes single-process usage for write coordination.
- **Built-in encryption or keychain integration.**
- **Sync API variants** (`readSync`, `writeSync`, etc.).
- **Alternative formats** (YAML, TOML, JSON5) — JSON is the only on-disk format.
- **Remote/cloud synchronization** or multi-device sync.
- **Domain-specific migration frameworks** beyond simple store-level upgrade hooks.

## License

MIT
