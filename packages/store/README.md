# @crustjs/store

Minimal, DX-first, type-safe config persistence for CLI apps.

`@crustjs/store` gives your CLI a production-ready config store with near-zero setup. It handles path resolution, file IO, parsing, validation, and error mapping so you don't have to.

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
import { createStore } from "@crustjs/store";

interface AppConfig {
  theme: "light" | "dark";
  verbose: boolean;
}

const store = createStore<AppConfig>({
  appName: "my-cli",
  defaults: { theme: "light", verbose: false },
});

// Read config (returns defaults when no persisted file exists)
const config = await store.read();
// → { theme: "light", verbose: false }

// Write a full config object
await store.write({ theme: "dark", verbose: true });

// Update a single field
await store.update((current) => ({ ...current, verbose: false }));

// Reset to defaults (removes persisted file)
await store.reset();
```

## API

### `createStore<TConfig>(options)`

Creates a typed async config store backed by a local JSON file. The file path is resolved once at creation time.

```ts
const store = createStore<TConfig>(options);
```

**Returns:** A `Store<TConfig>` with `read()`, `write()`, `update()`, and `reset()` methods.

**Throws:** `CrustStoreError` with `PATH` code if `appName` or `filePath` is invalid.

### Type strictness

Store config typing is strict: `createStore` must receive either `defaults` or `validate`.
This ensures `TConfig` is explicit/inferred and preserves field autocomplete for `read`, `write`, and `update`.

#### Options

| Option     | Type                          | Required | Description                                              |
| ---------- | ----------------------------- | -------- | -------------------------------------------------------- |
| `appName`  | `string`                      | Yes      | App name used to derive the config directory.            |
| `filePath` | `string`                      | No       | Explicit absolute `.json` path override.                 |
| `defaults` | `TConfig`                     | No*      | Default config returned by `read()` when no file exists. |
| `validate` | `(input: unknown) => TConfig` | No*      | Validator run on every `read`, `write`, and `update`.    |

\* At least one of `defaults` or `validate` is required for type inference.

### `store.read()`

Reads the persisted config file. When both persisted config and defaults exist, they are deep-merged in memory (see [Defaults & Deep Merge](#defaults--deep-merge)). Runs the optional validator on the final result.

```ts
const config = await store.read();
// TConfig | undefined
```

Returns `undefined` only when no persisted file exists **and** no defaults are configured.

### `store.write(config)`

Validates and atomically persists a full config object. The entire previous config is replaced.

```ts
await store.write({ theme: "dark", verbose: true });
```

### `store.update(updater)`

Reads the current effective config, applies the updater function, validates the result, and atomically persists it.

```ts
await store.update((current) => ({
  ...current,
  theme: "dark",
}));
```

> **Note:** `update()` requires either a persisted config file or configured defaults to exist. If there is nothing to update from, it throws a `CrustStoreError` with `IO` code.

### `store.reset()`

Removes the persisted config file. After reset, `read()` returns defaults (if configured) or `undefined`.

```ts
await store.reset();
```

Reset is idempotent — calling it when no file exists is a no-op.

## Config File Path

`@crustjs/store` resolves the config file path from `appName` using platform-standard conventions:

| Platform | Default Path                                          | Env Override       |
| -------- | ----------------------------------------------------- | ------------------ |
| Linux    | `~/.config/<appName>/config.json`                     | `$XDG_CONFIG_HOME` |
| macOS    | `~/Library/Application Support/<appName>/config.json` | —                  |
| Windows  | `%APPDATA%\<appName>\config.json`                     | `%APPDATA%`        |

To use a custom path instead, pass the `filePath` option:

```ts
const store = createStore<AppConfig>({
  appName: "my-cli",
  filePath: "/custom/path/settings.json",
  defaults: { theme: "light", verbose: false },
});
```

`filePath` must be an absolute path ending in `.json`. When provided, platform path derivation is bypassed entirely.

`appName` is always required and validated, even when `filePath` is provided.

## Defaults & Deep Merge

When both defaults and a persisted config file exist, `read()` deep-merges them in memory. Missing persisted fields are filled from defaults:

```ts
const store = createStore<AppConfig>({
  appName: "my-cli",
  defaults: { theme: "light", verbose: false, retries: 3 },
});

// Persisted file contains: { "theme": "dark" }
const config = await store.read();
// → { theme: "dark", verbose: false, retries: 3 }
```

### Merge rules

- **Nested objects** are merged recursively — only missing keys are filled from defaults.
- **Arrays** in the persisted config **replace** the default entirely (no element-level merging).
- **`null`** in the persisted config is an explicit value and replaces the default.
- **Extra keys** in the persisted config that are not in defaults are preserved.

### Important: defaults are not auto-persisted

Merged defaults exist only in memory. The merged result is **not** written back to disk. The persisted file remains unchanged until you explicitly call `write()` or `update()`.

## Validation

Pass a `validate` function to enforce config shape on every `read()`, `write()`, and `update()`:

```ts
const store = createStore<AppConfig>({
  appName: "my-cli",
  validate(input) {
    const config = input as Record<string, unknown>;
    if (!["light", "dark"].includes(config.theme as string)) {
      throw new Error(`Invalid theme: ${config.theme}`);
    }
    return config as AppConfig;
  },
});
```

The validator receives `unknown` and must return a valid `TConfig` or throw. Thrown errors are caught and normalized into `CrustStoreError` with `VALIDATION` code, with the original error preserved as `cause`.

### Schema library integration

The validator contract `(input: unknown) => TConfig` is compatible with popular schema libraries out of the box:

**Zod:**

```ts
import { z } from "zod";

const schema = z.object({
  theme: z.enum(["light", "dark"]),
  verbose: z.boolean(),
});

type AppConfig = z.infer<typeof schema>;

const store = createStore<AppConfig>({
  appName: "my-cli",
  validate: (input) => schema.parse(input),
});
```

**Valibot:**

```ts
import * as v from "valibot";

const schema = v.object({
  theme: v.picklist(["light", "dark"]),
  verbose: v.boolean(),
});

type AppConfig = v.InferOutput<typeof schema>;

const store = createStore<AppConfig>({
  appName: "my-cli",
  validate: (input) => v.parse(schema, input),
});
```

> **Note:** `@crustjs/store` does not ship first-party schema adapter packages. The examples above show how any throwing validator can be used directly.

## Error Handling

All errors thrown by `@crustjs/store` are instances of `CrustStoreError` with a typed `code` property:

| Code         | When                                                        | Details                     |
| ------------ | ----------------------------------------------------------- | --------------------------- |
| `PATH`       | Invalid `appName`, invalid `filePath`, unsupported platform | `{ path: string }`         |
| `PARSE`      | Malformed JSON in persisted config file                     | `{ path: string }`         |
| `VALIDATION` | User-provided validator rejected a config value             | `{ path?: string }`        |
| `IO`         | Filesystem read, write, or delete failure                   | `{ path, operation }`      |

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
      case "VALIDATION":
        console.error(`Invalid config: ${err.message}`);
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
  Store,
  StoreUpdater,
  StoreValidator,
  StoreErrorCode,
  StoreConfigShape,
} from "@crustjs/store";
```

| Type                 | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `CreateStoreOptions` | Options object for `createStore()`.                          |
| `Store`              | Store instance with `read`, `write`, `update`, `reset`.      |
| `StoreUpdater`       | Updater function type `(current: TConfig) => TConfig`.       |
| `StoreValidator`     | Validator function type `(input: unknown) => TConfig`.       |
| `StoreConfigShape`   | Base constraint for config types (`object`).                 |
| `StoreErrorCode`     | Union of error codes: `"PATH" \| "PARSE" \| "VALIDATION" \| "IO"`. |

## v1 Scope & Non-Goals

`@crustjs/store` v1 is intentionally minimal. The following are **not** included:

- **Generic state/cache abstractions** — v1 is config-only (single typed object per store).
- **Built-in encryption or keychain integration.**
- **Cross-process locking** — v1 assumes single-process usage for write coordination.
- **Sync API variants** (`readSync`, `writeSync`, etc.).
- **First-party schema adapter packages** — use schema libraries directly via the validator function.
- **Alternative formats** (YAML, TOML, JSON5) — JSON is the only on-disk format.
- **Deep `@crustjs/core` integration** — the store is a standalone package.

## License

MIT
