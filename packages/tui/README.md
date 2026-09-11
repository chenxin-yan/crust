# @crustjs/tui

OpenTUI adapter for Crust commands. This package is Bun-only.

Use any OpenTUI renderer with `runTui()`:

- Solid: `render(() => <App />, r)`
- React: `createRoot(r).render(<App />)`
- Core: `r.root.add(new TextRenderable(r, { content: "Hello" }))`

## Install

```sh
bun add @crustjs/tui @opentui/core
```

## Documentation

Full docs: [crustjs.com/docs/modules/tui](https://crustjs.com/docs/modules/tui)
