---
"@crustjs/utils": patch
---

Initial release at `0.0.1`. **Pre-stable** — public surface may change without notice until `0.1.0`. Pin to an exact version if depending externally.

First public export: `resolveSourceDir(input: string | URL): string` for three-mode source-directory resolution (`file:` URL via `fileURLToPath`, absolute path via `path.resolve`, or relative path resolved from the nearest `package.json` walking up from `process.argv[1]`).
