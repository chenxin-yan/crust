# @crustjs/tui

OpenTUI adapter for Crust commands. This package is Bun-only.

Use any OpenTUI renderer with `runTui()`:

- Solid: `render(() => <App />, r)`
- React: `createRoot(r).render(<App />)`
- Core: `r.root.add(new TextRenderable(r, { content: "Hello" }))`

## Install

```sh
npm install @crustjs/tui @opentui/core
```

Compile Solid apps with `"crust": { "bunPlugins": ["@opentui/solid/bun-plugin"] }` in `package.json`; React and core apps need no plugin. See [Compiling](https://crustjs.com/docs/modules/tui#compiling).

## Documentation

Full docs: [crustjs.com/docs/modules/tui](https://crustjs.com/docs/modules/tui)
