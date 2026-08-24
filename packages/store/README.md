# @crustjs/store

DX-first, typed persistence for CLI apps with config/data/state/cache separation

## Install

```sh
bun add @crustjs/store
```

## Behavior

`write()`, `update()`, and `patch()` return the state persisted after validation and schema transformations. File replacement is atomic, but `update()` does not lock its read-modify-write sequence across processes.

## Documentation

Full docs: [crustjs.com/docs/modules/store](https://crustjs.com/docs/modules/store)
