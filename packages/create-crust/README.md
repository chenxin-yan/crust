# create-crust

Scaffold a new Crust CLI project for Bun or Node.js

## Usage

```sh
npm create crust@latest my-cli
# or
pnpm create crust@latest my-cli
# or
bun create crust@latest my-cli
```

The initializer prompts for the runtime, build output, dependency installation, and Git initialization. Pass flags to skip the prompts:

```sh
npx create-crust@latest my-cli --runtime node --artifact binary --no-git
```

## Options

The initializer prompts for every option you don't pass. Without an interactive terminal, prompts take their defaults.

| Option                          | Default                                 | Effect                                                                                                                                                                |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[directory]`                   | prompt, `my-cli`                        | Destination. Its basename (the current directory's for `.`) becomes the package and command name: letters, digits, `.`, `_`, and `-`, starting with a letter or digit |
| `--runtime`                     | `bun`                                   | `bun` or `node`: the runtime used by the `dev` and `start` scripts and by `crust build`; saved as `crust.runtime` in `package.json`                                   |
| `--artifact`                    | `binary` for Bun, `package` for Node.js | `binary`: a standalone executable with the runtime embedded. `package`: a JavaScript bundle that needs the runtime installed. Saved as `crust.artifact`               |
| `--install`, `--no-install`     | install                                 | Install dependencies with the detected package manager                                                                                                                |
| `--git`, `--no-git`             | initialize                              | Initialize a Git repository; skipped inside an existing one                                                                                                           |
| `--overwrite`, `--no-overwrite` | prompt, don't overwrite                 | When the destination exists (or the current directory is not empty), overwrite conflicting files or abort                                                             |

Scripts in the next steps and generated README use the package manager detected from the destination's lockfiles, then the one running `create-crust`, defaulting to npm. Node.js binaries have extra build requirements; see [Build and distribution](https://crustjs.com/docs/guide/build-and-distribution#nodejs-binaries).

## Generated project

```text
my-cli/
├── src/cli.ts      # entry point with a sample command
├── package.json    # crust.runtime and crust.artifact, $schema for editor completion
├── tsconfig.json   # strict TypeScript config
├── README.md       # getting started
└── .gitignore
```

| Runtime | `dev`                | Default `build` output (`crust.artifact`)                                                        |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `bun`   | `bun run src/cli.ts` | `binary`: a root package with a Node.js launcher plus one standalone binary package per platform |
| `node`  | `node src/cli.ts`    | `package`: a root package with one JavaScript bundle that needs Node.js 24+                      |

`build` (`crust build`) stages the npm packages in `.crust/`, `start` runs the built `.crust/root/bin/<name>.js`, and `release` (`crust publish`) publishes them.

## Documentation

Full docs: [crustjs.com/docs/quick-start](https://crustjs.com/docs/quick-start)

## License

MIT
