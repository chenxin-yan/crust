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

Generated templates can be configured for either standalone binary distribution (`bin` -> `dist/cli`, `files: ["dist"]`) or Bun runtime package distribution (`bin` -> `dist/cli.js`, runtime deps) during scaffolding. Standalone binaries are the recommended default.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
