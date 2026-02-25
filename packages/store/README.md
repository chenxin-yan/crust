# @crustjs/store

Minimal, DX-first, type-safe config persistence for CLI apps.

`@crustjs/store` gives your CLI a production-ready config store with near-zero setup. Declare your fields, get full type inference, and let the store handle path resolution, file IO, defaults, and error mapping.

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
    verbose: { type: "boolean", default: false },
    token: { type: "string" }, // optional — no default
  },
});

// Read config (returns defaults when no persisted file exists)
const config = await store.read();
// → { theme: "light", verbose: false, token: undefined }

// Write a full config object
await store.write({ theme: "dark", verbose: true, token: "abc123" });

// Update a single field
await store.update((current) => ({ ...current, verbose: false }));

// Reset to defaults (removes persisted file)
await store.reset();
```

No explicit generics needed — types are inferred from your field definitions.

## API

### `createStore(options)`

Creates a typed async config store backed by a local JSON file. The file path is resolved once at creation time.

```ts
const store = createStore(options);
```

**Returns:** A `Store<TConfig>` with `read()`, `write()`, `update()`, and `reset()` methods.

**Throws:** `CrustStoreError` with `PATH` code if `dirPath` or `name` is invalid.

#### Options

| Option    | Type       | Required | Description                                                        |
| --------- | ---------- | -------- | ------------------------------------------------------------------ |
| `dirPath` | `string`   | Yes      | Absolute directory path where the JSON file is stored.             |
| `name`    | `string`   | No       | Store name used as filename (default `"config"` → `config.json`).  |
| `fields`  | `FieldsDef`| Yes      | Field definitions that declare the config schema.                  |

### `configDir(appName, env?)`

Resolves the platform-standard config directory for the given app name.

```ts
import { configDir } from "@crustjs/store";

const dir = configDir("my-cli");
// → "/home/user/.config/my-cli"       (Linux)
// → "/Users/user/Library/Application Support/my-cli"  (macOS)
// → "C:\\Users\\user\\AppData\\Roaming\\my-cli"       (Windows)
```

Use it with `dirPath`:

```ts
const store = createStore({
  dirPath: configDir("my-cli"),
  fields: { /* ... */ },
});
```

### Field Definitions

Each field in the `fields` record is a `FieldDef` with a `type` discriminant:

| Property      | Type                                    | Required | Description                                         |
| ------------- | --------------------------------------- | -------- | --------------------------------------------------- |
| `type`        | `"string" \| "number" \| "boolean"`    | Yes      | The value type.                                     |
| `default`     | Matches `type`                          | No       | Default value when the field is not persisted.       |
| `array`       | `true`                                  | No       | Collect values into an array.                        |
| `description` | `string`                                | No       | Human-readable description for tooling.              |

Type inference rules:

- **Has `default`** → field is guaranteed present (e.g., `string`)
- **No `default`** → field is optional (e.g., `string | undefined`)
- **`array: true`** → wraps the type in an array (e.g., `string[]`)

```ts
const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme:   { type: "string", default: "light" },       // → string
    verbose: { type: "boolean", default: false },         // → boolean
    retries: { type: "number", default: 3 },              // → number
    token:   { type: "string" },                          // → string | undefined
    tags:    { type: "string", array: true, default: [] },// → string[]
    ids:     { type: "number", array: true },             // → number[] | undefined
  },
});
```

### `store.read()`

Reads the persisted config file. Missing fields are filled from their `default` values. Fields without defaults are `undefined` when not persisted.

```ts
const config = await store.read();
```

Always returns a value — never `undefined`.

### `store.write(config)`

Atomically persists a full config object. The entire previous config is replaced.

```ts
await store.write({ theme: "dark", verbose: true, token: "abc123" });
```

### `store.update(updater)`

Reads the current effective config, applies the updater function, and atomically persists the result.

```ts
await store.update((current) => ({
  ...current,
  theme: "dark",
}));
```

When no persisted file exists, the updater receives field defaults as the current value.

### `store.reset()`

Removes the persisted config file. After reset, `read()` returns field defaults.

```ts
await store.reset();
```

Reset is idempotent — calling it when no file exists is a no-op.

## Config File Path

`configDir()` resolves the platform-standard config directory. The `name` option defaults to `"config"`, producing `config.json`:

| Platform | Default Path                                            | Env Override       |
| -------- | ------------------------------------------------------- | ------------------ |
| Linux    | `~/.config/<appName>/<name>.json`                       | `$XDG_CONFIG_HOME` |
| macOS    | `~/Library/Application Support/<appName>/<name>.json`   | —                  |
| Windows  | `%APPDATA%\<appName>\<name>.json`                       | `%APPDATA%`        |

### Multiple Stores

Use the `name` option to create multiple stores under the same directory:

```ts
import { createStore, configDir } from "@crustjs/store";

const dir = configDir("my-cli");

// Default store → ~/.config/my-cli/config.json
const configStore = createStore({
  dirPath: dir,
  fields: {
    theme: { type: "string", default: "light" },
    verbose: { type: "boolean", default: false },
  },
});

// Auth store → ~/.config/my-cli/auth.json
const authStore = createStore({
  dirPath: dir,
  name: "auth",
  fields: {
    token: { type: "string" },
  },
});
```

Each store is fully independent — reading, writing, updating, and resetting one store does not affect the others.

The `name` must not contain path separators or the `.json` extension.

## Defaults & Merge

When a persisted file exists, `read()` applies field defaults for any missing keys:

```ts
const store = createStore({
  dirPath: configDir("my-cli"),
  fields: {
    theme: { type: "string", default: "light" },
    verbose: { type: "boolean", default: false },
    retries: { type: "number", default: 3 },
  },
});

// Persisted file contains: { "theme": "dark" }
const config = await store.read();
// → { theme: "dark", verbose: false, retries: 3 }
```

### Merge rules

- Fields present in the persisted file use the persisted value.
- Missing fields with a `default` use the default value.
- Missing fields without a `default` are omitted (typed as `T | undefined`).
- Extra keys in the persisted file that are not defined in `fields` are dropped.
- Array defaults are shallow-copied to prevent shared mutation.
- Falsy values (`null`, `0`, `""`, `false`) in the persisted file are preserved — only truly missing keys trigger defaults.

### Important: defaults are not auto-persisted

Merged defaults exist only in memory. The merged result is **not** written back to disk. The persisted file remains unchanged until you explicitly call `write()` or `update()`.

## Error Handling

All errors thrown by `@crustjs/store` are instances of `CrustStoreError` with a typed `code` property:

| Code    | When                                                        | Details                     |
| ------- | ----------------------------------------------------------- | --------------------------- |
| `PATH`  | Invalid `dirPath`, invalid `name`, unsupported platform     | `{ path: string }`         |
| `PARSE` | Malformed JSON in persisted config file                     | `{ path: string }`         |
| `IO`    | Filesystem read, write, or delete failure                   | `{ path, operation }`      |

### Catching errors by code

```ts
import { CrustStoreError } from "@crustjs/store";

try {
  const config = await store.read();
} catch (err) {
  if (err instanceof CrustStoreError) {
    switch (err.code) {
      case "PARSE":
        console.error(`Corrupt config at ${err.details.path}`);
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
if (err instanceof CrustStoreError && err.is("PARSE")) {
  console.error("Original parse error:", err.cause);
}
```

### Malformed JSON

`@crustjs/store` does **not** silently recover from malformed JSON. If the persisted config file contains invalid JSON, `read()` throws a `CrustStoreError` with `PARSE` code immediately — no fallback to defaults.

## Types

All types are exported for use in your application:

```ts
import type {
  CreateStoreOptions,
  FieldDef,
  FieldsDef,
  InferStoreConfig,
  Store,
  StoreUpdater,
  ValueType,
  StoreErrorCode,
} from "@crustjs/store";
```

| Type                 | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `CreateStoreOptions` | Options object for `createStore()`.                                     |
| `FieldDef`           | Single field definition (discriminated by `type` and `array`).          |
| `FieldsDef`          | Record mapping field names to `FieldDef`.                               |
| `InferStoreConfig`   | Utility type: infers the config shape from a `FieldsDef`.               |
| `Store`              | Store instance with `read`, `write`, `update`, `reset`.                 |
| `StoreUpdater`       | Updater function type `(current: TConfig) => TConfig`.                  |
| `ValueType`          | Supported type literals: `"string" \| "number" \| "boolean"`.          |
| `StoreErrorCode`     | Union of error codes: `"PATH" \| "PARSE" \| "IO"`.                    |

## v1 Scope & Non-Goals

`@crustjs/store` v1 is intentionally minimal. The following are **not** included:

- **Generic state/cache abstractions** — v1 is config-only (single typed object per store).
- **Built-in encryption or keychain integration.**
- **Cross-process locking** — v1 assumes single-process usage for write coordination.
- **Sync API variants** (`readSync`, `writeSync`, etc.).
- **Built-in validation** — will be added later via `@crustjs/validate` integration.
- **Alternative formats** (YAML, TOML, JSON5) — JSON is the only on-disk format.
- **Deep `@crustjs/core` integration** — the store is a standalone package.

## License

MIT
