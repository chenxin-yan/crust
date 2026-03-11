# @crustjs/create-crust

Scaffold a new [Crust](https://crustjs.com) CLI project in seconds.

## Usage

```sh
bun create crust my-cli
```

This will prompt for your project directory, template style, distribution mode (standalone binaries recommended, or Bun runtime package), whether to install dependencies, and optionally initialize a git repository. The package name is inferred from the directory name.

`create-crust` includes two templates:

- `Minimal` — single-file starter (`src/cli.ts`)
- `Modular` — file-splitting pattern with `.sub()` and `.command(builder)`

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

If you need environment-specific public build constants, configure them with `crust build --env-file ...`.

> **Note:** The template's top-level `package.json` has `"files": ["dist"]` and `"bin"` pointing to `dist/cli` for local development. When publishing via `crust publish`, the staged packages in `dist/npm/` each have their own `package.json` with the correct `files` and `bin` entries — the top-level fields are not used for npm distribution.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
