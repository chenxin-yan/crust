# @crustjs/create-crust

Scaffold a new [Crust](https://crustjs.com) CLI project in seconds.

## Usage

```sh
bun create crust my-cli
```

This prompts for the project directory, distribution mode (standalone binaries recommended, or Bun runtime package), whether to install dependencies, and optionally whether to initialize a git repository. The package name is inferred from the directory name.

## Options

```text
create-crust [directory] [--distribution binary|runtime] [--install|--no-install] [--git|--no-git] [--overwrite]
```

- `directory` sets the destination; omit it to be prompted.
- `--distribution` selects standalone binaries or a Bun runtime package; omit it to choose interactively (default: `binary`).
- `--install` / `--no-install` controls dependency installation without prompting.
- `--git` / `--no-git` controls repository initialization without prompting when the destination is not already inside a Git repository.
- `--overwrite` allows scaffolding into an existing destination without prompting.

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

> **Note:** Binary projects use a top-level `bin` entry at `dist/cli` for local development. `crust build --package` generates staged packages in `dist/npm/`, each with its own platform-appropriate `files` and `bin` entries; those staged manifests are used for binary npm distribution. Runtime projects instead publish `dist/cli.js` directly.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
