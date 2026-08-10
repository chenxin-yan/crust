# create-crust

Scaffold a new [Crust](https://crustjs.com) CLI project in seconds.

## Usage

```sh
npm create crust@latest my-cli
# or
pnpm create crust@latest my-cli
# or
bunx create-crust@latest my-cli
# or
bun create crust@latest my-cli
# or
deno run -A npm:create-crust@latest my-cli
```

The CLI prompts for the project directory, distribution mode, dependency installation, and Git initialization. The package name is inferred from the directory name.

## Options

```text
create-crust [directory] [--distribution binary|runtime] [--install|--no-install] [--git|--no-git] [--overwrite|--no-overwrite]
```

- `directory` sets the destination; omit it to be prompted.
- `--distribution` selects standalone binaries (the default) or a Bun runtime package.
- `--install` / `--no-install` answers the dependency installation prompt.
- `--git` / `--no-git` answers the repository initialization prompt. Git initialization is skipped inside an existing repository.
- `--overwrite` / `--no-overwrite` answers the existing-destination confirmation.

All prompts are resolved before files are written.

## Generated project

Both distribution modes share the same todo application:

```text
src/
├── app.ts
├── app.test.ts
├── cli.ts
├── shared.ts
└── commands/
    ├── add.ts
    ├── done.ts
    ├── list.ts
    └── remove.ts
```

The starter demonstrates split command definitions, typed positional arguments and flags, a lazy Context with an owned `--data-file` flag and native cleanup, help/version/color/suggestion/completion Extensions, and testing with `captureRun()` plus a Context double.

### Standalone binaries

The recommended mode compiles self-contained executables that do not require Bun on the end user's machine:

1. `bun run build` — build raw binaries.
2. `bun run package` — stage npm-ready platform packages in `dist/npm`.
3. `bun run publish` — publish the staged packages in dependency order.

### Bun runtime package

The runtime mode builds `dist/cli.js`, keeps Core and Extensions as runtime dependencies, and requires Bun on the end user's machine. `bun publish` runs the `prepack` build automatically.

## Documentation

See [crustjs.com](https://crustjs.com).

## License

MIT
