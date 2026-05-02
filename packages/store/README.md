# @crustjs/store

DX-first, typed persistence for CLI apps with clear config/data/state/cache separation.

`@crustjs/store` gives your CLI production-ready local persistence with near-zero setup. Provide a `fields` definition, pick a storage intent, and get a typed store with read/write/update/patch/reset — no manual type annotations needed.

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
  fields: {
    theme: { type: "string", default: "light" },
    fontSize: { type: "number", default: 14 },
    verbose: { type: "boolean", default: false },
  },
});

// Read state (returns defaults when no persisted file exists)
const state = await store.read();
// → { theme: "light", fontSize: 14, verbose: false }

// Write a full state object
await store.write({ theme: "dark", fontSize: 16, verbose: true });

// Update with a function
await store.update((current) => ({ ...current, verbose: false }));

// Patch only specific keys
await store.patch({ theme: "solarized" });

// Reset to defaults (removes persisted file)
await store.reset();
```

No explicit generics needed — types are inferred from your `fields` definition.

## Storage Intent: Choosing a Directory

`@crustjs/store` provides four path helpers that resolve platform-standard directories for different storage intents. Use the one that matches what you're persisting:

| Helper      | Intent                    | Example Use Case                       |
| ----------- | ------------------------- | -------------------------------------- |
| `configDir` | User preferences & config | Theme, editor settings, API keys       |
| `dataDir`   | Important app data        | Local databases, downloaded resources  |
| `stateDir`  | Runtime state             | Window positions, scroll offsets, undo |
| `cacheDir`  | Regenerable cached data   | HTTP caches, compiled assets           |

```ts
import {
  createStore,
  configDir,
  dataDir,
  stateDir,
  cacheDir,
} from "@crustjs/store";

// User preferences → ~/.config/my-cli/config.json
const config = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: { type: "string", default: "light" },
    verbose: { type: "boolean", default: false },
  },
});

// App data → ~/.local/share/my-cli/config.json
const data = createStore({
  dirPath: dataDir("my-cli"),
  fields: {
    bookmarks: { type: "array", default: [] },
  },
});

// Runtime state → ~/.local/state/my-cli/config.json
const state = createStore({
  dirPath: stateDir("my-cli"),
  fields: {
    lastOpened: { type: "string", default: "" },
    scrollY: { type: "number", default: 0 },
  },
});

// Cache → ~/.cache/my-cli/config.json
const cache = createStore({
  dirPath: cacheDir("my-cli"),
  fields: {
    etag: { type: "string", default: "" },
    payload: { type: "string", default: "" },
  },
});
```

### Platform Paths

All four helpers follow XDG conventions on Linux and macOS, and Windows-native conventions on Windows:

| Helper      | Linux / macOS          | Windows                      | Env Override       |
| ----------- | ---------------------- | ---------------------------- | ------------------ |
| `configDir` | `~/.config/<app>`      | `%APPDATA%\<app>`            | `$XDG_CONFIG_HOME` |
| `dataDir`   | `~/.local/share/<app>` | `%LOCALAPPDATA%\<app>\Data`  | `$XDG_DATA_HOME`   |
| `stateDir`  | `~/.local/state/<app>` | `%LOCALAPPDATA%\<app>\State` | `$XDG_STATE_HOME`  |
| `cacheDir`  | `~/.cache/<app>`       | `%LOCALAPPDATA%\<app>\Cache` | `$XDG_CACHE_HOME`  |

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

| Option         | Type        | Required | Description                                                                                  |
| -------------- | ----------- | -------- | -------------------------------------------------------------------------------------------- |
| `dirPath`      | `string`    | Yes      | Absolute directory path where the JSON file is stored.                                       |
| `name`         | `string`    | No       | Store name used as filename (default `"config"` → `config.json`).                            |
| `fields`       | `FieldsDef` | Yes      | Field definitions defining the store's data shape, types, defaults, and optional validation. |
| `pruneUnknown` | `boolean`   | No       | Drop unknown persisted keys on read (default `true`).                                        |

### `store.read()`

Reads the persisted state file. Missing keys are filled from field `defaults`.

```ts
const state = await store.read();
```

Always returns a value — never `undefined`. Does not write merged defaults back to disk.

### `store.write(state)`

Atomically persists a full state object. The entire previous state is replaced.

```ts
await store.write({ theme: "dark", fontSize: 14, verbose: true });
```

Calls per-field `validate` functions (if provided) before writing. Parent directories are created if missing.

### `store.update(updater)`

Reads the current effective state, applies the updater function, and atomically persists the result.

```ts
await store.update((current) => ({
  ...current,
  theme: "dark",
}));
```

When no persisted file exists, the updater receives field `defaults` as the current value. Calls per-field `validate` functions before writing.

### `store.patch(partial)`

Applies a shallow partial update to the current state and persists. Only the provided keys are updated; everything else is preserved.

```ts
await store.patch({ theme: "solarized" });
```

Calls per-field `validate` functions before writing.

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
  fields: {
    theme: { type: "string", default: "light" },
    fontSize: { type: "number", default: 14 },
    verbose: { type: "boolean", default: false },
  },
});

// Auth store → ~/.config/my-cli/auth.json
const authStore = createStore({
  dirPath: dir,
  name: "auth",
  fields: {
    token: { type: "string", default: "" },
  },
});
```

Each store is fully independent — reading, writing, updating, and resetting one store does not affect the others.

The `name` must not contain path separators or the `.json` extension.

## Defaults & Merge

When a persisted file exists, `read()` fills missing keys from field `defaults`:

```ts
const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: { type: "string", default: "light" },
    fontSize: { type: "number", default: 14 },
    verbose: { type: "boolean", default: false },
  },
});

// Persisted file contains: { "theme": "dark", "verbose": true }
const state = await store.read();
// → { theme: "dark", fontSize: 14, verbose: true }
```

### Merge Rules

- Persisted values override defaults.
- Missing keys fall back to defaults.
- Unknown persisted keys are dropped by default (`pruneUnknown: true`). Set `pruneUnknown: false` to preserve them.
- All values are deep-cloned to prevent shared-reference mutation from defaults.
- Falsy values (`null`, `0`, `""`, `false`) in the persisted file are preserved — only truly missing keys trigger defaults.

### Important: defaults are not auto-persisted

Merged defaults exist only in memory. The persisted file remains unchanged until you explicitly call `write()`, `update()`, or `patch()`.

## Validation

Add per-field validation to enforce config integrity on every read, write, update, and patch. When a `validate` function is configured on a field, validation is **strict by default** — invalid values fail loudly.

### Using `@crustjs/validate`

The easiest way to add validation is with [field adapters](https://crustjs.com/docs/modules/validate#store-field-validation) from `@crustjs/validate`:

```ts
import { z } from "zod";
import { field } from "@crustjs/validate";
import { createStore, configDir } from "@crustjs/store";

const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: {
      type: "string",
      default: "light",
      validate: field(z.enum(["light", "dark"])),
    },
    verbose: { type: "boolean", default: false },
  },
});

// write() validates before persisting
await store.write({ theme: "neon", verbose: true });
// → throws CrustStoreError("VALIDATION")

// read() validates after applying defaults
const config = await store.read();
// → throws if persisted config is invalid
```

`fieldSync()` is also available for synchronous schemas. For the full field
validator contract — sync vs async, error normalization, and prompt-side
integration — see [`@crustjs/validate` Store field validation](https://crustjs.com/docs/modules/validate#store-field-validation).

For Effect schemas, wrap with `Schema.standardSchemaV1()`:

```ts
import * as Schema from "effect/Schema";
import { field } from "@crustjs/validate";

const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: {
      type: "string",
      default: "light",
      validate: field(Schema.standardSchemaV1(Schema.Literal("light", "dark"))),
    },
  },
});
```

> **Effect ≥ 3.14.2 required.** Effect 3.14.2 made `standardSchemaV1(...)`
> wrappers expose `.ast`, which is what the validate registry walks. On
> Effect 3.14.0 / 3.14.1 the wrapper is a plain object and introspection
> silently fails. See
> [`@crustjs/validate` Effect setup](https://crustjs.com/docs/modules/validate#quick-start--effect)
> for the floor and a workaround.

### Custom validators

You can also provide a validator function directly on each field:

```ts
const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: {
      type: "string",
      default: "light",
      validate(value) {
        const str = value as string;
        if (str !== "light" && str !== "dark") {
          return {
            ok: false,
            issues: [{ message: 'Must be "light" or "dark"', path: "" }],
          };
        }
        return { ok: true, value: str };
      },
    },
  },
});
```

The per-field `validate` function follows the `StoreValidator<T>` contract: `(value: unknown) => StoreValidatorResult<T> | Promise<StoreValidatorResult<T>>`, where `StoreValidatorResult<T>` is `{ ok: true, value: T } | { ok: false, issues: StoreValidatorIssue[] }`.

### Validation behavior

- **Write**: Validates each field before persisting. If a validator transforms the value, the transformed result is persisted.
- **Read**: Validates each field after applying defaults. Invalid persisted config fails loudly — no silent fallback to defaults.
- **Update**: Reads raw config (no validation), applies updater, validates each field, then persists.
- **Patch**: Reads raw config, applies shallow partial merge, validates each field, then persists.
- **Reset**: No validation — just removes the persisted file.

### Catching validation errors

```ts
import { CrustStoreError } from "@crustjs/store";

try {
  await store.read();
} catch (err) {
  if (err instanceof CrustStoreError && err.is("VALIDATION")) {
    // err.details is { operation: "read" | "write" | "update" | "patch", issues: StoreValidationIssue[] }
    console.error(`Validation failed during ${err.details.operation}:`);
    for (const issue of err.details.issues) {
      console.error(`  ${issue.path || "(root)"}: ${issue.message}`);
    }
  }
}
```

## Error Handling

All errors thrown by `@crustjs/store` are instances of `CrustStoreError` with a typed `code` property:

| Code         | When                                                    | Details                 |
| ------------ | ------------------------------------------------------- | ----------------------- |
| `PATH`       | Invalid `dirPath`, invalid `name`, unsupported platform | `{ path: string }`      |
| `PARSE`      | Malformed JSON in persisted config file                 | `{ path: string }`      |
| `IO`         | Filesystem read, write, or delete failure               | `{ path, operation }`   |
| `VALIDATION` | Config fails validator on read, write, update, or patch | `{ operation, issues }` |

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
  Store,
  StoreUpdater,
  FieldDef,
  FieldsDef,
  InferStoreConfig,
  StoreValidator,
  StoreValidatorResult,
  StoreValidatorIssue,
  StoreErrorCode,
  StoreValidationIssue,
  ValidationErrorDetails,
  PlatformEnv,
} from "@crustjs/store";
```

| Type                     | Description                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `CreateStoreOptions`     | Options object for `createStore()`.                                                            |
| `Store`                  | Store instance with `read`, `write`, `update`, `patch`, `reset`.                               |
| `StoreUpdater`           | Updater function type `(current: T) => T`.                                                     |
| `FieldDef`               | Single field definition with `type`, optional `default`, and optional `validate`.              |
| `FieldsDef`              | Record of field names to `FieldDef` definitions.                                               |
| `InferStoreConfig`       | Inferred store state type from a `FieldsDef` definition.                                       |
| `StoreValidator`         | Validator function contract `(value: unknown) => StoreValidatorResult`.                        |
| `StoreValidatorResult`   | Discriminated union: `{ ok: true, value: T } \| { ok: false, issues: StoreValidatorIssue[] }`. |
| `StoreValidatorIssue`    | `{ message: string, path: string }`.                                                           |
| `StoreValidationIssue`   | Validation issue in error details payload.                                                     |
| `ValidationErrorDetails` | Error details for `VALIDATION` code: `{ operation, issues }`.                                  |
| `StoreErrorCode`         | Union of error codes: `"PATH" \| "PARSE" \| "IO" \| "VALIDATION"`.                             |
| `PlatformEnv`            | Injectable platform environment for testing path helpers.                                      |
| `CrustStoreError`        | Typed error class with `code`, `details`, and `cause`.                                         |

## Scope & Non-Goals

`@crustjs/store` is intentionally focused. The following are **not** included:

- **Cross-process locking** — assumes single-process usage for write coordination.
- **Built-in encryption or keychain integration.**
- **Sync API variants** (`readSync`, `writeSync`, etc.).
- **Automatic migration of invalid persisted config** — validation fails loudly; callers handle recovery.
- **Alternative formats** (YAML, TOML, JSON5) — JSON is the only on-disk format.
- **Remote/cloud synchronization** or multi-device sync.
- **Domain-specific migration frameworks** beyond simple store-level upgrade hooks.

## License

MIT
