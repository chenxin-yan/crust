---
"create-crust": minor
---

Scaffolded projects follow the single `crust build` flow: every runtime gets `build` (`crust build`, stages `.crust/`), `release` (`crust publish`), and `start` (runs `.crust/root/bin/<name>.js`), with `bin` pointing at that launcher and `"crust": { "runtime": ... }` set explicitly. The `files`, `package`, `publish`, and `prepack` entries are gone; `.crust` is gitignored.

`create-crust` itself now ships as a `crust build` Node package: `.crust/root/bin/create-crust.js` plus the `templates` directory via `crust.include`.
