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

The initializer collects the destination, any required overwrite decision, runtime, build output, dependency installation choice, and Git initialization choice. Explicit flags skip the corresponding prompts; prompts can also use defaults without rendering non-interactively. The package name is inferred from the directory name.

## Options

```text
create-crust [directory] [--runtime bun|node|deno] [--artifact package|binary] [--install|--no-install] [--git|--no-git] [--overwrite|--no-overwrite]
```

- `directory` sets the destination; otherwise the directory prompt defaults to `my-cli`. Its basename (the current directory's for `.`) becomes the package and command name, so it must use only letters, digits, `.`, `_`, `~`, and `-`, not starting with `.` or `-`; anything else is rejected before any file is written.
- `--runtime` selects the runtime the project develops and builds for: `bun`, `node`, or `deno`. The default is `bun`.
- `--artifact` selects the build output independently of the runtime: `package` for a JavaScript bundle requiring the user's selected runtime, or `binary` for a standalone executable embedding that runtime. Defaults: `binary` for Bun/Deno, `package` for Node.js. Deno runtime-package bundling is experimental.
- `--install` / `--no-install` installs or skips dependencies. The default is to install. Deno projects install with `deno install`; the other runtimes use the detected package manager. If installation is skipped, the next steps include the install command.
- `--git` / `--no-git` initializes or skips a Git repository when the destination is not already inside one. The default is to initialize.
- When the destination requires an overwrite decision, `--overwrite` overwrites conflicting files without confirmation; `--no-overwrite` aborts without prompting. The default is not to overwrite.

Generated projects use the single-file starter (`src/cli.ts`). The generated README and next steps use the detected package manager for script commands (`bun run`, `npm run`, `pnpm run`, or `yarn run`), independently of the selected runtime. Detection checks the destination's lockfiles first, then the invoking package manager's user-agent, and defaults to npm. Deno projects always use `deno task`.

Every generated project includes:

- `src/cli.ts` — entry point with a sample command
- `package.json` — configured for the selected runtime and artifact, with `$schema` pointing at the `crust` block schema shipped by `@crustjs/crust` for editor completion
- `tsconfig.json` — strict TypeScript config
- `README.md` — getting started instructions
- `.gitignore` — sensible defaults for Node/Bun projects

Every project has the same scripts: `build` (`crust build`) stages the publishable npm package(s) in `.crust/`, `start` runs the built CLI from `.crust/root/bin/<name>.js`, and `release` (`crust publish`) publishes them. The runtime decides how the project runs in development; the `crust.artifact` setting decides what `build` puts in `.crust/`. All six combinations are selectable; the defaults preserve each runtime's established output:

| Runtime | `dev`                    | `build` output (`crust.artifact`)                                                             |
| ------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `bun`   | `bun run src/cli.ts`     | `binary`: a root package with a Node launcher plus one standalone binary package per platform |
| `node`  | `node src/cli.ts`        | `package`: a root package containing one JavaScript bundle that needs Node 22.18+             |
| `deno`  | `deno run -A src/cli.ts` | `binary`: a root package with a Node launcher plus one standalone binary package per platform |

Every runtime puts the Crust packages your code imports (`@crustjs/core`, `@crustjs/extensions`) in `dependencies` and the build tool (`@crustjs/crust`) in `devDependencies`, and writes your selections to `"crust": { "runtime": ..., "artifact": ... }` in `package.json` so `crust build` needs no additional flags.

For example, scaffold a Node binary or an experimental Deno runtime package:

```sh
npx create-crust@latest my-node-cli --runtime node --artifact binary
npx create-crust@latest my-deno-cli --runtime deno --artifact package
```

Node binaries need Node 26+ and Bun at build time; Node runtime packages do not need the Node executable compiler. Deno packages need Deno 2.5+ to bundle. The wizard does not install or pin compilers. See [Build and distribution](https://crustjs.com/docs/guide/build-and-distribution) for complete requirements.

Artifact choice is separate from distribution channel. `release` publishes to npm, but npm is optional: standalone executables plus adjacent assets can be shipped as downloads or through Homebrew/Scoop without a separate JavaScript runtime. The npm binary launcher requires Node.js. The generated README links to [custom distribution](https://crustjs.com/docs/guide/build-and-distribution#custom-distribution); the wizard does not generate installer definitions.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
