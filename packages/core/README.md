# @crustjs/core

Core library for the Crust CLI framework

## Install

```sh
bun add @crustjs/core
```

## Documentation

Full docs: [crustjs.com/docs/modules/core](https://crustjs.com/docs/modules/core)

Tooling calls `app.snapshot()` for a frozen, validated command snapshot, including authored and Extension-contributed `meta.sections`; the `CommandSnapshot` type comes from the `@crustjs/core/tooling` subpath. Other helpers on that subpath are intended for first-party tooling that moves in lockstep with core. Application code should use the package root.
