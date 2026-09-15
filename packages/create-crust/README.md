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

The initializer collects the destination, any required overwrite decision, runtime, dependency installation choice, and Git initialization choice. Explicit flags skip the corresponding prompts; prompts can also use defaults without rendering non-interactively. The package name is inferred from the directory name.

## Options

```text
create-crust [directory] [--runtime bun|node|deno] [--install|--no-install] [--git|--no-git] [--overwrite|--no-overwrite]
```

- `directory` sets the destination; otherwise the directory prompt defaults to `my-cli`.
- `--runtime` selects the runtime the project develops and builds for: `bun`, `node`, or `deno`. The default is `bun`.
- `--install` / `--no-install` installs or skips dependencies. The default is to install. Deno projects install with `deno install`; the other runtimes use the detected package manager.
- `--git` / `--no-git` initializes or skips a Git repository when the destination is not already inside one. The default is to initialize.
- When the destination requires an overwrite decision, `--overwrite` overwrites conflicting files without confirmation; `--no-overwrite` aborts without prompting. The default is not to overwrite.

Generated projects use the single-file starter (`src/cli.ts`).

Every generated project includes:

- `src/cli.ts` — entry point with a sample command
- `package.json` — configured for the selected runtime
- `tsconfig.json` — strict TypeScript config
- `README.md` — getting started instructions
- `.gitignore` — sensible defaults for Node/Bun projects

Every project has the same scripts: `build` (`crust build`) stages the publishable npm package(s) in `.crust/`, `start` runs the built CLI from `.crust/root/bin/<name>.js`, and `release` (`crust publish`) publishes them. The runtime decides how the project runs in development and what `build` puts in `.crust/`:

| Runtime | `dev`                    | `build` output                                                                      |
| ------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `bun`   | `bun run src/cli.ts`     | A root package with a Node launcher plus one standalone binary package per platform |
| `node`  | `node src/cli.ts`        | A root package containing one JavaScript bundle that needs Node 22.18+              |
| `deno`  | `deno run -A src/cli.ts` | A root package with a Node launcher plus one standalone binary package per platform |

Every runtime puts the Crust packages your code imports (`@crustjs/core`, `@crustjs/extensions`) in `dependencies` and the build tool (`@crustjs/crust`) in `devDependencies`, and sets `"crust": { "runtime": ... }` in `package.json` so `crust build` picks the runtime without flags. See [Build and distribution](https://crustjs.com/docs/guide/build-and-distribution).

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
