---
"@crustjs/crust": patch
---

Add musl Linux targets and drop the legacy `-baseline` target names.

- `bun-linux-x64-musl` and `bun-linux-arm64-musl` join the default Bun target set. `--package` stages them as `<name>-linux-x64-musl` / `<name>-linux-arm64-musl` and writes an npm `libc` field on every Linux platform package, so npm and pnpm download only the glibc or musl package that matches the host. The generated Node launcher and shell resolver detect musl (Alpine, Void, …) and select the matching binary.
- `bun-linux-x64-baseline` and `bun-windows-x64-baseline` are replaced by `bun-linux-x64` and `bun-windows-x64`; Bun 1.4 ships one x64 binary and treats the suffix as a legacy alias. Binary filenames lose the suffix (`my-cli-bun-linux-x64-baseline` → `my-cli-bun-linux-x64`), and the old target names are rejected.
- The shell resolver written by multi-target builds is POSIX `sh`, so it runs on Alpine without Bash.

```sh
# before
crust build --target bun-linux-x64-baseline
# after
crust build --target bun-linux-x64 --target bun-linux-x64-musl
```

Bun's musl executables load `libstdc++` and `libgcc` dynamically; bare Alpine images need `apk add libstdc++ libgcc`.
