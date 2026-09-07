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

The initializer collects the destination, any required overwrite decision, distribution mode, dependency installation choice, and Git initialization choice. Explicit flags skip the corresponding prompts; prompts can also use defaults without rendering non-interactively. The package name is inferred from the directory name.

## Options

```text
create-crust [directory] [--distribution binary|runtime] [--install|--no-install] [--git|--no-git] [--overwrite|--no-overwrite]
```

- `directory` sets the destination; otherwise the directory prompt defaults to `my-cli`.
- `--distribution` selects `binary` for standalone executables or `runtime` for a JavaScript build run with Bun. The default is `binary`.
- `--install` / `--no-install` installs or skips dependencies. The default is to install.
- `--git` / `--no-git` initializes or skips a Git repository when the destination is not already inside one. The default is to initialize.
- When the destination requires an overwrite decision, `--overwrite` overwrites conflicting files without confirmation; `--no-overwrite` aborts without prompting. The default is not to overwrite.

Generated projects use the single-file starter (`src/cli.ts`).

Every generated project includes:

- `src/cli.ts` — entry point with a sample command
- `package.json` — configured for the selected distribution mode
- `tsconfig.json` — strict TypeScript config
- `README.md` — getting started instructions
- `.gitignore` — sensible defaults for Node/Bun projects

Generated templates can be configured for either standalone binary distribution or Bun runtime package distribution during scaffolding.

For standalone binary projects, the intended workflow is:

1. `bun run build` — raw binaries (`crust build`)
2. `bun run package` — npm-ready staged packages in `dist/npm` (`crust build --package`)
3. `bun run publish` — publish the staged packages (`crust publish`)

The binary templates intentionally keep `build` and `package` as separate scripts because they do different jobs:

- `build` is for raw binary artifacts.
- `package` is for npm packaging (alias for `crust build --package`).
- `publish` is for registry upload.

If you need public build-time constants, `crust build` can use Bun's cwd env by default or explicit `--env-file` inputs.

> **Note:** Binary projects use a top-level `bin` entry at `dist/cli` for local development. `crust build --package` generates staged packages in `dist/npm/`, each with its own platform-appropriate `files` and `bin` entries; those staged manifests are used for binary npm distribution. The generated binary template's own `files` list excludes Extension artifact directories; use the staged packages to include them.

Bun runtime projects use `bun build src/cli.ts --target bun --outfile dist/cli.js` and run the result with `bun run dist/cli.js`. This separate workflow does not use `crust build --runtime node`, snapshot preparation, or Extension build hooks.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
