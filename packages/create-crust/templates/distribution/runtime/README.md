# {{name}}

A todo CLI built with [Crust](https://crustjs.com).

## Try it

```sh
bun run dev add write documentation --priority high
bun run dev list --no-done
bun run dev done 1
bun run dev remove 1
```

Todos are stored in `todos.json`. Pass `--data-file <path>` before or after a command to use another file.

## Project structure

- `src/app.ts` configures the root, Context, and Extensions.
- `src/cli.ts` adds command definitions and executes the app.
- `src/shared.ts` owns the todo Context and its `--data-file` flag.
- `src/commands/` contains inert, independently testable command definitions.
- `src/app.test.ts` demonstrates `captureRun()` and a Context test double.

## Development

```sh
bun run dev --help
bun run test
bun run check:types
bun run build
```

## Releasing the Bun runtime package

This package requires Bun on the end user's machine. Update its name and version, then publish locally:

```sh
bun publish
```

The `prepack` script rebuilds `dist/cli.js` before publication.
