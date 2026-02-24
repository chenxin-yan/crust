# @crustjs/store

Minimal, type-safe config persistence for CLI apps.

## API

> Pending implementation. See [SPEC.md](../../.ralph/SPEC.md) for planned API surface.

### Type strictness (current)

- Store config typing is strict: `createStore` must receive either `defaults` or `validate`.
- This ensures `TConfig` is explicit/inferred and preserves field autocomplete for `read`, `write`, and `update`.
