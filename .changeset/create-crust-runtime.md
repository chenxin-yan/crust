---
"create-crust": minor
---

The `Distribution mode` prompt and `--distribution binary|runtime` flag are replaced by a `Runtime` prompt and `--runtime bun|node|deno`. Distribution follows from the runtime instead of being asked separately: Bun projects keep the compiled-binary template with `package` and `publish` scripts; Node projects set `"crust": { "runtime": "node" }` and build one `dist/cli.js` bundle with `crust build`, published through `prepack`; Deno projects set `"crust": { "runtime": "deno" }` and compile standalone executables with `crust build`. The old Bun-only "runtime package" mode that bundled with `bun build` is removed.

The generated `tsconfig.json` `lib` and `types` now match the runtime (`@types/bun`, `@types/node`, or Deno's own globals), the starter imports `package.json` with `with { type: "json" }` so it runs on Node and Deno, and the README and "Next steps" use the runtime's script runner (`bun run`, `npm run`, or `deno task`).
