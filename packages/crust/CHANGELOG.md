# @crustjs/crust

## 0.6.0

### Minor Changes

- [#531](https://github.com/chenxin-yan/crust/pull/531) [`0cfdcd5`](https://github.com/chenxin-yan/crust/commit/0cfdcd59d938b5d01c6c9d258b69172aa94931e5) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust build` now precompiles Bun binaries to bytecode (`bun build --compile --bytecode`), so they start without parsing their JavaScript: a 30-command CLI starts in ~12 ms instead of ~22 ms, for ~2% more binary size. Pass `--no-bytecode` (or `bytecode: false` to `build()`) to opt out. `--bytecode` is rejected for runtime packages and Node.js binaries, which cannot use Bun bytecode.

- [#539](https://github.com/chenxin-yan/crust/pull/539) [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Drop Deno support. Crust now targets Bun and Node.js only.
  
  - `@crustjs/crust`: `crust.runtime: "deno"` and Deno targets are removed; `deno.json`/`deno.jsonc` no longer selects a runtime. `--minify` now defaults to `true` in `--help`.
  - `create-crust`: `--runtime deno` is no longer accepted.
  - `@crustjs/utils`: `PACKAGED_BUILD_KEY` and `isPackagedBuild` are removed from `@crustjs/utils/artifacts`, and Deno compiled executables are no longer detected.
  - `@crustjs/core`: the snapshot protocol no longer checks the packaged-build marker.
  - `@crustjs/mcp`: Deno standalone builds are no longer detected as compiled executables.

- [#542](https://github.com/chenxin-yan/crust/pull/542) [`f5fbbfd`](https://github.com/chenxin-yan/crust/commit/f5fbbfdb91bfeb79221228bec29731f00b816158) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - On macOS and Linux, the generated npm launcher now replaces itself with the platform binary (`process.execve`) instead of running it as a child process. Signals and the exit status now belong to the binary alone, as if it ran directly: a `SIGINT` sent to the launcher's PID inside a terminal is no longer dropped, and a `SIGINT` sent to the whole process group without a terminal no longer arrives twice. The launcher needs Node.js `>=24`, like every Crust package, which the root package now declares in `engines.node` (library `exports` keep your range), and prints the required version on unsupported Node.js. It also loads faster, since it no longer imports Node.js modules at startup. Windows, which has no `execve`, keeps the spawning launcher.

### Patch Changes

- [#567](https://github.com/chenxin-yan/crust/pull/567) [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust build` without an artifact kind no longer mentions what earlier versions built implicitly; the error lists the two artifact kinds and how to choose one.

- [#516](https://github.com/chenxin-yan/crust/pull/516) [`9d65fde`](https://github.com/chenxin-yan/crust/commit/9d65fde51504a66abceff8bcc25195036f7a6a22) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - On Windows, the generated npm launcher now forwards `SIGTERM` and `SIGHUP` to the platform binary, stays alive through Ctrl-C while the binary cleans up, and exits with the binary's exit code or signal. Previously the binary was orphaned on `SIGTERM` and its exit code was lost on Ctrl-C.
  
  `crust publish` now fails with "Stage is stale" when the project `package.json` name or version differs from what `crust build` staged in `.crust/`; run `crust build` again.
  
  `build({ targets })` suggests known target names in editors.

- [#555](https://github.com/chenxin-yan/crust/pull/555) [`2d03498`](https://github.com/chenxin-yan/crust/commit/2d03498f3547ae0a219772556923c04e9a83e70c) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust build` now embeds a V8 code cache in Node.js binaries when the `node` on `PATH` is the exact official binary a target embeds (the host's own target, built without `NODE_OPTIONS`), so each command starts without compiling its JavaScript first: 1 to 2 ms less for a 30-command CLI on Linux x64. Other targets and other builds of Node.js get no cache, since V8 would reject it with a warning at every start. The build prints `Code cache: on`, or `off` with the reason; when targets differ, it lists them per group, as in `on for linux-x64; off for darwin-arm64 (cross-built)`.

- [#502](https://github.com/chenxin-yan/crust/pull/502) [`bc7a51a`](https://github.com/chenxin-yan/crust/commit/bc7a51af63866846f93cc345ccf8a5f04686ec59) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update the bundled Node executable backend to `tsdown` and `@tsdown/exe` 0.23.4.

- [#540](https://github.com/chenxin-yan/crust/pull/540) [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - On Bun on Linux, a CLI started with a signal ignored (SIGHUP under `nohup`, SIGINT for a background job in a script) now keeps ignoring it. Core's Ctrl-C handling, timed `runProcess()` calls, and `crust build`'s snapshot step no longer listen for an ignored signal; listening replaced the ignore, and Bun restores the default action when the listener is removed, so the process could die from a signal it was started to ignore. Node already resets inherited ignores at startup, so nothing changes there. macOS on Bun still loses the ignore until Bun keeps the previous disposition (oven-sh/bun#47574). Adds `isSignalIgnored()` from `@crustjs/utils/signals`.

- [#583](https://github.com/chenxin-yan/crust/pull/583) [`ba6070a`](https://github.com/chenxin-yan/crust/commit/ba6070ae4e9ac878fd7d16339feac51e0069ea1c) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - On Linux, the generated npm launcher now detects glibc or musl by reading the C library Node.js itself is linked against, instead of building a diagnostic report on every start, so npm-installed binaries start faster. It falls back to the previous check when that is not possible.

- [#520](https://github.com/chenxin-yan/crust/pull/520) [`7811b12`](https://github.com/chenxin-yan/crust/commit/7811b12f73827e1d47a1574c4b88736eb82632b0) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - On POSIX, `runProcess()` with a `timeout` now also kills the child's process group when the calling process receives `SIGINT`, `SIGTERM`, `SIGHUP`, or `SIGQUIT`, or exits synchronously. The call rejects, and the signal is re-raised when no other listener handles it. Previously the detached child and its descendants outlived an interrupted parent. `crust build` uses this for its compiler `--version` probe, so interrupting a build no longer leaves a stuck probe running.
  
  `@crustjs/utils/process` exports `bindToProcessLifetime()`, the signal and exit policy `runProcess()` and `crust build`'s entry preparation now share.
- Updated dependencies [[`6a7e073`](https://github.com/chenxin-yan/crust/commit/6a7e073c4cb59452a03f41cbe656fd03e2b56dc9), [`29d07af`](https://github.com/chenxin-yan/crust/commit/29d07afabce709506fee35261bf035799de33abb), [`a805be3`](https://github.com/chenxin-yan/crust/commit/a805be3923e60e64e34fb3ac49a41b9f4b7cf71a), [`fd54147`](https://github.com/chenxin-yan/crust/commit/fd541473c362c3f0c1054513ca00bbd681287d78), [`3c78cc9`](https://github.com/chenxin-yan/crust/commit/3c78cc9cc461be383551f599e838cb1e7253a4a1), [`f935d7a`](https://github.com/chenxin-yan/crust/commit/f935d7a2a71bebbb1da8201c112d3c688ed50f53), [`4f4d9e9`](https://github.com/chenxin-yan/crust/commit/4f4d9e9eb44a7f43577bfd883ae7959dd112ac64), [`80a8c62`](https://github.com/chenxin-yan/crust/commit/80a8c62389994bd5368c96464e4f7d7b74ef222a), [`8bf19e2`](https://github.com/chenxin-yan/crust/commit/8bf19e2627ccf49a74792ae84d363718ebc04b9f), [`0cdd29f`](https://github.com/chenxin-yan/crust/commit/0cdd29fb72ff71e67348f5d7e8cae75753cfaed5), [`324fb81`](https://github.com/chenxin-yan/crust/commit/324fb814c9ee55d3824e520f719e80de010fd83e), [`cc3048c`](https://github.com/chenxin-yan/crust/commit/cc3048cb281e4f6cf556e81ed7358d7e2fb0e52c), [`484e055`](https://github.com/chenxin-yan/crust/commit/484e0552aeadbaa4103bc61553f1183ee25b212c), [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7), [`6e4e59b`](https://github.com/chenxin-yan/crust/commit/6e4e59bfa71d72daf39ceebc752e27d29b0449af), [`014d5aa`](https://github.com/chenxin-yan/crust/commit/014d5aa41499d1a0cc69f83589a0ff7a0f0432c7), [`46ab354`](https://github.com/chenxin-yan/crust/commit/46ab3549974b98b36329471cf212e3171e8fdf5e), [`da6dace`](https://github.com/chenxin-yan/crust/commit/da6dacef13b95abcbe5472ebaf1de441cddb0003), [`0a2c6b1`](https://github.com/chenxin-yan/crust/commit/0a2c6b198b07b693789f10a4c0532f27b94a6a9d), [`8544498`](https://github.com/chenxin-yan/crust/commit/854449869f795f00505952dc04d653f2e7f6f923), [`d5a9522`](https://github.com/chenxin-yan/crust/commit/d5a9522f11836b7c6beac79901f87f6d74d608a2), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`7e2da48`](https://github.com/chenxin-yan/crust/commit/7e2da482af5a21d27a2d32839a051cc6e0c36974), [`e974d05`](https://github.com/chenxin-yan/crust/commit/e974d05834785604ed16551613baec9e7a961c4a), [`8876005`](https://github.com/chenxin-yan/crust/commit/887600526c5a01229f00c26cd81ba86bf1305001), [`9592652`](https://github.com/chenxin-yan/crust/commit/95926524d877ebc6d20307095408bac2f5fa95d4), [`0ab1ca1`](https://github.com/chenxin-yan/crust/commit/0ab1ca1e69caa38a872a2cf36266b200664d5228), [`2209085`](https://github.com/chenxin-yan/crust/commit/22090852b5d212756be2ed9d1a2411dbb688f912), [`8ff9c6a`](https://github.com/chenxin-yan/crust/commit/8ff9c6abeaf3b89adb90f72c533d98d5c13ccce9), [`a074f45`](https://github.com/chenxin-yan/crust/commit/a074f454a28611f0a0a1f3d0bab8df50b235960d), [`48823e8`](https://github.com/chenxin-yan/crust/commit/48823e82c50f583b990b99f49f5441bcf0280723), [`9a0d85c`](https://github.com/chenxin-yan/crust/commit/9a0d85c70560a394781f976949a517cba6515bcb), [`09a6808`](https://github.com/chenxin-yan/crust/commit/09a68080e8809b507dbcd0c581bd9942b186f44b), [`02993c7`](https://github.com/chenxin-yan/crust/commit/02993c71a43cafa1cbbd9853bf00e991efccb1cb), [`3273ceb`](https://github.com/chenxin-yan/crust/commit/3273ceb045554c446ac7da4937885700bf349d17), [`97e8def`](https://github.com/chenxin-yan/crust/commit/97e8def311a44507f4c06f16843f840bfa587d12), [`d863ca6`](https://github.com/chenxin-yan/crust/commit/d863ca674800fe6a1595187378129c2bef86a9f6), [`75555f3`](https://github.com/chenxin-yan/crust/commit/75555f37d8624114c02cf8af3cace0e6826aef02), [`76c59f8`](https://github.com/chenxin-yan/crust/commit/76c59f8df5e91ae09e96cd1e6fe8f85d22ecb6d7), [`de79812`](https://github.com/chenxin-yan/crust/commit/de798128f888f9525fd7b58adce9366f4c8f9610), [`5530b8f`](https://github.com/chenxin-yan/crust/commit/5530b8f67b329928696a4102efc73e9a3f6153cf), [`3f6a973`](https://github.com/chenxin-yan/crust/commit/3f6a973e7765856a36444c7a14e96b96a6faee14), [`25b631d`](https://github.com/chenxin-yan/crust/commit/25b631d0236c7b3c99eb69d19fb52c24a2f65043), [`516bb0a`](https://github.com/chenxin-yan/crust/commit/516bb0a6bff1aa10c31080b799ef76c54ec12331), [`34df0c6`](https://github.com/chenxin-yan/crust/commit/34df0c604910ceab083a7e88910cc510da4a5c5a), [`83d1670`](https://github.com/chenxin-yan/crust/commit/83d16708c0e107f264f3b7089228c562d74abfd3), [`a411ccb`](https://github.com/chenxin-yan/crust/commit/a411ccb1b09eb05dd372757549631f429587981f), [`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`27f5832`](https://github.com/chenxin-yan/crust/commit/27f583260be2ad90544dd85d5653f7ab23255cff), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d), [`0ab1ca1`](https://github.com/chenxin-yan/crust/commit/0ab1ca1e69caa38a872a2cf36266b200664d5228), [`83d1670`](https://github.com/chenxin-yan/crust/commit/83d16708c0e107f264f3b7089228c562d74abfd3), [`a411ccb`](https://github.com/chenxin-yan/crust/commit/a411ccb1b09eb05dd372757549631f429587981f), [`47276ed`](https://github.com/chenxin-yan/crust/commit/47276eda8b9cd08c6a0717f4f443824a3027eba7), [`b31c7d9`](https://github.com/chenxin-yan/crust/commit/b31c7d9e2fbc0f3fc8cf162ed7d2339c6d0c800f), [`0cdd29f`](https://github.com/chenxin-yan/crust/commit/0cdd29fb72ff71e67348f5d7e8cae75753cfaed5), [`0a2c6b1`](https://github.com/chenxin-yan/crust/commit/0a2c6b198b07b693789f10a4c0532f27b94a6a9d), [`3f6a973`](https://github.com/chenxin-yan/crust/commit/3f6a973e7765856a36444c7a14e96b96a6faee14), [`7ad4bc1`](https://github.com/chenxin-yan/crust/commit/7ad4bc144f31f524c8221c69d2750d745018f00d), [`ff5b5d4`](https://github.com/chenxin-yan/crust/commit/ff5b5d4e02dd039875170c96734d5cad9485553d), [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073), [`3f0db61`](https://github.com/chenxin-yan/crust/commit/3f0db6189a1e33d3c5e9dbee44624feadc8a7cb0), [`e9c5af3`](https://github.com/chenxin-yan/crust/commit/e9c5af35ae43d934a30da9b88528df35e1e75f85), [`aad9c15`](https://github.com/chenxin-yan/crust/commit/aad9c156dd89b3283e73cb420aac724d2f3598eb), [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761), [`4e2c3d7`](https://github.com/chenxin-yan/crust/commit/4e2c3d73577561d447e0ef58f7fc521b8a6fa3fa), [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`51f16e7`](https://github.com/chenxin-yan/crust/commit/51f16e725216e8c064408c97613cab91f6d6bf56), [`0cf0914`](https://github.com/chenxin-yan/crust/commit/0cf091408ad9e1251b6e8f42712b20299e591309), [`71cd6dd`](https://github.com/chenxin-yan/crust/commit/71cd6dd8b0e5af788e11ccd68616b3c7b1c693ba), [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19), [`db2f5b3`](https://github.com/chenxin-yan/crust/commit/db2f5b391ccbcc6750e98e9219511ecf0820baf6), [`6ef96cd`](https://github.com/chenxin-yan/crust/commit/6ef96cdc8349991ca77360e906f6ae56863cc38b), [`bc85878`](https://github.com/chenxin-yan/crust/commit/bc858780958074fad17424509e5a4190e5e7d468), [`f49de57`](https://github.com/chenxin-yan/crust/commit/f49de57eb0d77220617792669fb185f1e20e656d), [`6ce95ed`](https://github.com/chenxin-yan/crust/commit/6ce95edb85095d8e8c3ab27fed8226d320fc3d82), [`3a6dbb1`](https://github.com/chenxin-yan/crust/commit/3a6dbb1702cff684c17054cd476ddef0b5d56f99)]:
  - @crustjs/core@0.6.0
  - @crustjs/extensions@0.6.0
  - @crustjs/style@0.4.0

## 0.5.6

### Patch Changes

- [#494](https://github.com/chenxin-yan/crust/pull/494) [`f88cb79`](https://github.com/chenxin-yan/crust/commit/f88cb7961993b0db60fe2376bd33ae1d8e34837d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update the bundled Node executable backend to `tsdown` and `@tsdown/exe` 0.23.1.
- Updated dependencies []:
  - @crustjs/core@0.5.6
  - @crustjs/extensions@0.5.6

## 0.5.5

### Patch Changes

- [#487](https://github.com/chenxin-yan/crust/pull/487) [`c4fa066`](https://github.com/chenxin-yan/crust/commit/c4fa06687f97342dcd6f4e7cc9c1f1f5d6ff3f3d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `crust.external` for Node and Bun runtime packages. Listed packages, such as `"crust": { "external": ["better-sqlite3"] }`, stay out of the bundle and ship as `dependencies` of the staged root package with their ranges from `dependencies`, so npm installs them beside the bundle. Each entry must be a `dependencies` key with a publishable range; `@crustjs/*` packages (including npm aliases of them), binaries, and the Deno runtime are rejected before `.crust/` is replaced.
  
  Staged `peerDependencies` now also reject `file:`, `link:`, and `portal:` ranges, local paths, and local tarballs, which only resolve on the publishing machine, in addition to `workspace:` and `catalog:`.
- Updated dependencies []:
  - @crustjs/core@0.5.5
  - @crustjs/extensions@0.5.5

## 0.5.4

### Patch Changes

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust build` now reports a missing or non-object `package.json` directly instead of failing later with an unrelated artifact or `name` error.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust publish` now names a corrupt staged `manifest.json` or `package.json` and asks you to run `crust build` again, instead of printing a bare JSON `SyntaxError`.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust build` now rejects a Command Snapshot without a root command name with the "invalid Command Snapshot" guidance instead of a `TypeError`.

- [#484](https://github.com/chenxin-yan/crust/pull/484) [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust build` now rejects `bin` keys (and the package-name command) that start with `_` or contain `~`, matching the names `completion()` already required. Command names use letters, digits, `.`, `_`, and `-`, starting with a letter or digit. To migrate, rename such commands, for example `"_tool"` to `"tool"` or `"my~cli"` to `"my-cli"`, along with their root `new Crust(name)`.

- [#484](https://github.com/chenxin-yan/crust/pull/484) [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust --help` shows the package's reworded description: "CLI to build and publish Crust apps as npm packages or standalone binaries".
- Updated dependencies [[`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444), [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444), [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444), [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444), [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444), [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14), [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14), [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14), [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14), [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14), [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444), [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444), [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444), [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444)]:
  - @crustjs/core@0.5.4
  - @crustjs/extensions@0.5.4
  - @crustjs/style@0.3.6

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - @crustjs/core@0.5.3
  - @crustjs/extensions@0.5.3

## 0.5.2

### Patch Changes

- Updated dependencies [[`4a0fce5`](https://github.com/chenxin-yan/crust/commit/4a0fce520c5c6e528d2137c533d75fd779cd2b58), [`3696635`](https://github.com/chenxin-yan/crust/commit/36966358ad7a9c6b25dfdbef83bffc2a7c981e29), [`6323fac`](https://github.com/chenxin-yan/crust/commit/6323facd4c45ea7b478576006f013cf7797d4116)]:
  - @crustjs/core@0.5.2
  - @crustjs/extensions@0.5.2

## 0.5.1

### Patch Changes

- [#469](https://github.com/chenxin-yan/crust/pull/469) [`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject overlapping builds of the same project across processes using an exclusive .crust.lock directory. Release the lock on success or failure, preserve the current stage when another build holds it, and explain manual recovery after an interrupted process.
- Updated dependencies [[`7ec6ded`](https://github.com/chenxin-yan/crust/commit/7ec6ded6f433081034ad49dc67017cb65608fffc), [`ea04984`](https://github.com/chenxin-yan/crust/commit/ea0498441ba9599c7c1dbf1cf1f3128f71f126d2), [`a7e083a`](https://github.com/chenxin-yan/crust/commit/a7e083a6794335ea0723c085ff405fa6f96a5fd1), [`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b)]:
  - @crustjs/core@0.5.1
  - @crustjs/extensions@0.5.1
  - @crustjs/style@0.3.5

## 0.5.0

### Minor Changes

- [#456](https://github.com/chenxin-yan/crust/pull/456) [`0da2c5c`](https://github.com/chenxin-yan/crust/commit/0da2c5ce54f71acc5d51fad1dcb2c5546a71948e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: `crust build` and `build()` now require an explicit artifact kind, set with `"crust": { "artifact": "package" | "binary" }` in package.json, `--artifact`, or the `artifact` build option (the option overrides the config). The implicit defaults are gone: to keep the previous output, set `"artifact": "binary"` for bun and deno projects and `"artifact": "package"` for node projects; the error names the old default for the inferred runtime. Runtime inference is unchanged. New Bun runtime packages (`"runtime": "bun", "artifact": "package"`) stage one root-only package whose commands are Bun-targeted bundles behind `#!/usr/bin/env bun`, so installed commands run on the consumer's Bun. Runtime packages reject `--target` and `crust.targets`. Binary builds select the compiler once (external `bun` on PATH first, then the embedded Bun; `deno` on PATH), check its reported version against `engines.bun`/`engines.deno` before replacing `.crust/` (a `--version` probe that does not exit within 30 seconds is killed and fails the build), print it as `Compiler:`, and record it as `embeddedRuntimeVersion` in `manifest.json`, which now also records `runtime` and `artifact`. Crust never installs or upgrades a compiler. create-crust templates set `crust.artifact` to keep each runtime's existing output.

- [#458](https://github.com/chenxin-yan/crust/pull/458) [`4360cb1`](https://github.com/chenxin-yan/crust/commit/4360cb1cefca245e76967ade43c82b5361c039e5) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Node standalone binaries: `"runtime": "node", "artifact": "binary"` (or `--artifact binary` for a node project) now builds one Node.js single executable per command and platform with tsdown's executable builder, behind the usual Node launcher and platform packages. `@crustjs/crust` now optionally depends on `tsdown` and `@tsdown/exe`, which the installed crust runs with the external `node` on PATH; no global tsdown is needed. Package managers skip them, rather than failing an engine-strict install, under a Node outside tsdown's engines or with optional dependencies disabled; every other build still works, and Node binary builds then report the missing backend, or a reachable tsdown other than the version crust pins (such as the project's own), before replacing `.crust/` (reinstall with optional dependencies under a compatible Node). That node is the embedded runtime for every target: it must satisfy `engines.node` and the installed tsdown's own requirements (its package engines and executable minimum, Node 26+ with tsdown 0.23), checked before `.crust/` is replaced. Crust never installs or upgrades it. Targets use Node's release names (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win-x64`, `win-arm64`; no musl); every target's official Node.js archive of the same version is downloaded, verified, unpacked, and cached before `.crust/` is replaced, so a missing `tar` (GNU tar also needs `xz` for Linux targets) or `unzip` (Windows targets on other hosts) keeps the previous build, and macOS executables are only signed when built on macOS. Bun first bundles each command for Node exactly like a Node runtime package (so main-module guards, CommonJS entries, and env-file `PUBLIC_*` values behave as in every other build), which makes Bun required for Node binary builds even with `--no-validate`, checked before `.crust/` is replaced; application dependencies are bundled and any other leftover import fails the build; `crust.bunPlugins` is rejected for Node binaries. Staged Node binary packages omit `engines.node`, except on a root that publishes library `exports`. `resolveArtifactDir()` now resolves next to the executable inside a Node single executable application.

- [#457](https://github.com/chenxin-yan/crust/pull/457) [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add experimental Deno runtime packages. With `"crust": { "runtime": "deno", "artifact": "package" }` (or `--artifact package`), `crust build` bundles each command with native `deno bundle`, which Deno marks experimental, into a root-only npm package whose `bin/<command>.js` files run on the consumer's installed Deno through `deno run npm:<package>/<command>` or `deno install -g`. The package embeds no runtime, carries no shebang or permission flags, and leaves every grant to the consumer. Building needs `deno` 2.5.0 or newer on PATH, checked in the project directory before `.crust/` is replaced; the bundler version is printed as `Compiler:` but not recorded as `embeddedRuntimeVersion`, and `engines.deno` stays a consumer requirement. `--minify`, `--env-file`, `crust.bunPlugins`, `--target`, and `crust.targets` are rejected for this mode. Deno binaries and their permissions are unchanged.
  
  Finished Deno packages mark themselves through a marker prepended to the bundle, preserving `import.meta.main` for the declared command, so `@crustjs/core` skips Command Snapshot and build-hook execution and `resolveArtifactDir()` from `@crustjs/utils/artifacts` resolves assets beside the installed package, without reading any environment variable. The package must be built against this `@crustjs/core` release or newer: with an older core, the finished package needs `--allow-env` and obeys build-only snapshot variables.

### Patch Changes

- [#466](https://github.com/chenxin-yan/crust/pull/466) [`340f3f1`](https://github.com/chenxin-yan/crust/commit/340f3f19aa73d026ccf5617f6291b601fcf7b864) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fail and clean up hung Command Snapshot preparation at the build deadline, including entries that ignore SIGTERM and descendants holding stderr. Interrupting or exiting the build also stops the entry, and processes the entry leaves in its process group are stopped once preparation finishes.

- [#466](https://github.com/chenxin-yan/crust/pull/466) [`340f3f1`](https://github.com/chenxin-yan/crust/commit/340f3f19aa73d026ccf5617f6291b601fcf7b864) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject crust.include and Extension artifact directories that collide with `bin` or each other only by letter case, since they alias on case-insensitive file systems.
- Updated dependencies [[`bc3cbb2`](https://github.com/chenxin-yan/crust/commit/bc3cbb250974fcdba4ce2f50ee4b6b90a1f16c30), [`c4f44d6`](https://github.com/chenxin-yan/crust/commit/c4f44d6f9e3dd206154d0b18a84fb75464dc2dfe), [`c6f4bd8`](https://github.com/chenxin-yan/crust/commit/c6f4bd8f3de3558d9c988acf63830ec899cf6854), [`0b835c2`](https://github.com/chenxin-yan/crust/commit/0b835c20b9bcf09e9dea7f179eeecd43a9c50763), [`eb9928d`](https://github.com/chenxin-yan/crust/commit/eb9928d60edc3033652ad55a3a019e790dafdf06), [`1a9004f`](https://github.com/chenxin-yan/crust/commit/1a9004f94c65380a750b1461f3f24a18f521644f), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93)]:
  - @crustjs/core@0.5.0
  - @crustjs/style@0.3.4
  - @crustjs/extensions@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @crustjs/core@0.4.1
  - @crustjs/extensions@0.4.1

## 0.4.0

### Minor Changes

- [#437](https://github.com/chenxin-yan/crust/pull/437) [`41cab19`](https://github.com/chenxin-yan/crust/commit/41cab19f22e2a9b6d7315a2079334ec840352dc1) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add the programmatic `build()` API: `import { build } from "@crustjs/crust"` runs the `crust build` pipeline (same options as the flags: `cwd`, `targets`, `envFiles`, `minify`, `validate`, plus `onLog`) and returns the staged `stageDir`, generated `artifacts`, and per-command Extension `reports`. It is silent unless `onLog` is given and throws on failure; `crust build` is now a thin wrapper over it. The published package ships the library as a bundled `dist/` with declarations, and `crust build` now carries a project's `exports`, `peerDependencies`, and `peerDependenciesMeta` fields into the staged root package (`exports` targets validated against the staged files and Node's target rules, peer ranges must be publishable as written; projects without these fields are unchanged). `@crustjs/crust` declares `@crustjs/core` as a peer dependency so the re-exported `BuildReport` is core's own type. The Command Snapshot subprocess uses `bun` from `PATH` like compilation does, so `build()` also works under Node when Bun is installed.
  
  Carried CommonJS `.js`/`.d.ts` exports require an included nested package scope, or explicit `.cjs`/`.d.cts` extensions, to avoid changing their module format under the generated ESM root. Unresolved `workspace:` and `catalog:` peer ranges are rejected because staged manifests are published without rewriting.

### Patch Changes

- [#437](https://github.com/chenxin-yan/crust/pull/437) [`41cab19`](https://github.com/chenxin-yan/crust/commit/41cab19f22e2a9b6d7315a2079334ec840352dc1) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject overlapping programmatic builds of the same project before they can overwrite each other's staged files.
- Updated dependencies [[`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb), [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb)]:
  - @crustjs/core@0.4.0
  - @crustjs/extensions@0.4.0

## 0.3.6

### Patch Changes

- Updated dependencies []:
  - @crustjs/core@0.3.6
  - @crustjs/extensions@0.3.6

## 0.3.5

### Patch Changes

- [#429](https://github.com/chenxin-yan/crust/pull/429) [`6e96295`](https://github.com/chenxin-yan/crust/commit/6e962954fbb349667c15c5232143a4fc93be696b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust build` reads a default target list from `crust.targets` in `package.json`, so a CLI that ships a fixed subset of platforms (for example glibc-only Linux because a native dependency has no musl build) runs a bare `crust build` instead of repeating `--target` flags. Accepts the same values as `--target`, which still overrides it per run; rejected for the Node runtime.
- Updated dependencies []:
  - @crustjs/core@0.3.5
  - @crustjs/extensions@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [[`26baf42`](https://github.com/chenxin-yan/crust/commit/26baf426534a2df0493a3be29c34f1574810fea1), [`9d19b33`](https://github.com/chenxin-yan/crust/commit/9d19b33a077247f47689b64e1babe1527638b9ed), [`52e0938`](https://github.com/chenxin-yan/crust/commit/52e0938ceee270340c366afb59f756d455d1623a), [`5183e78`](https://github.com/chenxin-yan/crust/commit/5183e78b60f263b4da820d3214863ef715d3dca4), [`2835c5b`](https://github.com/chenxin-yan/crust/commit/2835c5b1d2df03585c58c579d50e0ef6298138a0), [`cac21ad`](https://github.com/chenxin-yan/crust/commit/cac21ad6c9a57423aabf048cd3bf25223d52a1ae), [`b02c2af`](https://github.com/chenxin-yan/crust/commit/b02c2af97addd3e7064dff2155d6bf3b2a27c6cd), [`05603c9`](https://github.com/chenxin-yan/crust/commit/05603c9049edc0f0c7f74e6e22b8a69ecfe02dd6)]:
  - @crustjs/core@0.3.4
  - @crustjs/extensions@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [[`63ef15c`](https://github.com/chenxin-yan/crust/commit/63ef15c2a009c87cc568d1eab2d1011332417057)]:
  - @crustjs/core@0.3.3
  - @crustjs/extensions@0.3.3

## 0.3.2

### Patch Changes

- [#410](https://github.com/chenxin-yan/crust/pull/410) [`941b457`](https://github.com/chenxin-yan/crust/commit/941b4575d648a654bec89c698fab80841366348f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust publish` now checks each staged `name@version` on the target registry with `npm view` before uploading and skips versions that already exist, so rerunning after a partial failure resumes instead of failing on the packages that already went up. The lookup replays the staged `publishConfig` registry settings to `npm view` so it targets the registry `npm publish` would (npm 10.6+ precedence); any answer other than "exists" or E404 aborts before anything is uploaded. `--dry-run` stays offline.

- [#408](https://github.com/chenxin-yan/crust/pull/408) [`10cfb50`](https://github.com/chenxin-yan/crust/commit/10cfb507699e5b1df346200f7815e8d9aa4b3ad3) Thanks [@pullfrog](https://github.com/apps/pullfrog)! - Allow npm browser and OTP authentication during interactive crust publish runs by inheriting terminal stdio.
- Updated dependencies [[`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7)]:
  - @crustjs/core@0.3.2
  - @crustjs/extensions@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`4350974`](https://github.com/chenxin-yan/crust/commit/4350974af6b81ce9f0db1e3951cdf8b7b0b43b3d), [`d5937f8`](https://github.com/chenxin-yan/crust/commit/d5937f843240e0244a542e5c294bcfc4f16574ff)]:
  - @crustjs/style@0.3.3
  - @crustjs/extensions@0.3.1
  - @crustjs/core@0.3.1

## 0.3.0

### Minor Changes

- [#386](https://github.com/chenxin-yan/crust/pull/386) [`955f85c`](https://github.com/chenxin-yan/crust/commit/955f85c130400c7c8d0e63efa9b16807482dba3e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - ### @crustjs/crust
  
  `crust build` now stages publishable npm packages in `.crust/`, replacing that tree on each staged build. Node produces a root-only package with a self-contained `bin/<command>.js` bundle; Bun and Deno produce a root launcher plus platform packages. Deno's Linux targets are glibc-only. The staged CLI runs locally, and `crust publish` publishes the same tree using `.crust/manifest.json`.
  
  `crust build` keeps four flags: `--target` (repeatable; canonical names or `host` for this machine, deduplicated), `--env-file`, `--validate/--no-validate`, and `--minify/--no-minify`. Removed `--package`, `--stage-dir` (build and publish), `--outdir`, `--name`, `--resolver`, `--outfile`, `--runtime`, `--entry`, `--bun-plugin`, and the raw `dist/` multi-binary layout with `cli`/`cli.cmd` shell resolvers. For a single binary on Bun or Deno, run `crust build --target host` and take `.crust/<platform>/bin/<command>-<target>`; Node accepts no `--target` and always produces `.crust/root/bin/<command>.js`. `.crust/manifest.json` is the index.
  
  Build configuration lives in one `package.json` block; unknown keys under `crust` are an error:
  
  ```json
  {
    "bin": { "my-cli": "src/cli.ts" },
    "crust": {
      "runtime": "bun",
      "bunPlugins": ["@opentui/solid/bun-plugin"],
      "include": ["templates"]
    }
  }
  ```
  
  Runtime selection follows `crust.runtime`, then inference: `deno.json`/`deno.jsonc` selects Deno; `@types/node` without `@types/bun` selects Node; otherwise Bun. Builds report the selected runtime and its source. `crust.bunPlugins` lists Bun bundler plugin modules: bare names resolve from `node_modules`, paths from the project root, each default-exporting the plugin; Deno rejects it. `crust.include` copies asset directories alongside Extension artifacts into the root package and each platform package's `bin/`. Every bundle defines `process.env.CRUST_INTERNAL_BUILD` as `"1"`; the name is reserved and reads of it are replaced at build time.
  
  `@crustjs/crust` ships a JSON schema for the `crust` block at `node_modules/@crustjs/crust/schema/package.json` (extending SchemaStore's package.json schema) for editor completion; point `"$schema"` at it in `package.json`.
  
  `crust publish` keeps `--tag`, `--dry-run`, and `--registry`; removed `--access` and `--verify`. Staged metadata is always verified. npm reads `publishConfig.access` from each staged `package.json`, so scoped public packages need `publishConfig.access: "public"` in `package.json` (copied into every staged package). `npm publish` runs inside each `.crust/<package>` directory, so a project-level `.npmrc` is not read; use trusted publishing, `NPM_CONFIG_USERCONFIG`, or `~/.npmrc`.
  
  ### create-crust
  
  Replaced the distribution-mode prompt and `--distribution` with a runtime prompt and `--runtime bun|node|deno`. All templates explicitly set `crust.runtime`, point `bin` at `src/cli.ts` (which starts with the runtime's shebang: `#!/usr/bin/env bun`, `#!/usr/bin/env node`, or `#!/usr/bin/env -S deno run -A`, so `npm link` runs the source), and use `build` (`crust build`), `release` (`crust publish`), and `start` (the staged `.crust/root/bin/<name>.js` entry). Removed the old `package`, `publish`, and `prepack` scripts and `files` field; `.crust` is gitignored.
  
  Templates use runtime-specific TypeScript settings, JSON import attributes, and script-runner instructions. `@crustjs/core` and `@crustjs/extensions` are dependencies; `@crustjs/crust` is a development dependency.
  
  Generated `package.json` files start with `"$schema": "./node_modules/@crustjs/crust/schema/package.json"` so editors complete and validate the `crust` block.
  
  `create-crust` itself now ships as a Crust-built Node bundle, with templates staged through `crust.include` and located through `resolveArtifactDir("templates")`.
  
  ### @crustjs/core
  
  Added `resolveArtifactDir(name)` for top-level artifact directories: beside the executable in compiled Bun/Deno binaries, beside `bin/` in Crust-built Node bundles, under the entry's isolated hook output directory while `crust build` prepares the Command Snapshot (so sections evaluated during the build see what earlier Extension build hooks wrote), or under `.crust/root/` at the real entrypoint's nearest package root when running from source. It computes the path without checking whether the artifact directory exists.
  
  ### @crustjs/skills
  
  Removed `SkillOptions.distDir` and the previous skill-source fallback logic. Packaged skills now come from `resolveArtifactDir("skills")`; remove `distDir` from your configuration and run `crust build`. Missing or empty packaged skills produce a build-first diagnostic, rendered as a note in help rather than failing help.

- [#390](https://github.com/chenxin-yan/crust/pull/390) [`e450975`](https://github.com/chenxin-yan/crust/commit/e450975f70d9dffda5fe068b55d56c48eb17ab44) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Build every package.json bin source entry as a separate command, replacing crust.entry. Validate root names, reject duplicate entries and case-colliding command names, and merge isolated hook output with collision errors. Stage and validate all commands in root and platform packages. Scaffold runtime-specific source shebangs so npm link runs source; link .crust/root to exercise built output.

- [#393](https://github.com/chenxin-yan/crust/pull/393) [`19c99e7`](https://github.com/chenxin-yan/crust/commit/19c99e77ffcff792527064354b2c5b9d756c51df) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - ### @crustjs/core
  
  **Breaking:** Extension build hooks return their files instead of writing them. `build(ctx)` now returns `BuildArtifacts = readonly BuildFile[]`, where `BuildFile` is `{ path, content }` with `path` relative to the build output directory and `content` a `string` or `Uint8Array`. Returning `void` is no longer allowed. Core validates every path, rejects a path that collides with one already produced in this or an earlier hook (equal paths compared case-insensitively, or a path nested under or above an existing file; the error names both spellings and the owning Extension), writes the files into the output directory, and records exactly the written paths; `BuildReport.extensions[].files` is always `readonly string[]` (the `"unknown"` marker is gone). `ExtensionBuildContext` no longer exposes `outDir`: hooks have no handle to write beside their returned files, which is what makes the report exact. A hook that drives an external tool should write to its own temporary directory and read the results back.
  
  Migration: replace `mkdir`/`writeFile` calls in a hook with returned entries, and drop `outDir` from the destructured context.
  
  ```ts
  // before
  async build({ snapshot, outDir }) {
    await mkdir(join(outDir, "acme"), { recursive: true });
    await writeFile(join(outDir, "acme", "manifest.json"), JSON.stringify(snapshot));
    return ["acme/manifest.json"];
  }
  // after
  build({ snapshot }) {
    return [{ path: "acme/manifest.json", content: JSON.stringify(snapshot) }];
  }
  ```
  
  ### @crustjs/crust
  
  `crust build` records each `bin` entry's Build Report under `build` in `.crust/manifest.json` (`build.<command>.extensions[].files`), so the manifest lists exactly which files every Extension produced. The field is absent under `--no-validate`, which skips the hooks. The build summary no longer prints `ran (artifacts not reported)`. Since hooks cannot produce symlinks anymore, multi-entry artifact merging no longer copies symlinks.
  
  ### @crustjs/man
  
  The `man()` build hook returns the rendered page instead of writing it. `writeManPage()` is unchanged as a standalone render-and-write helper.
  
  ### @crustjs/skills
  
  The `skill()` build hook returns rendered skill files instead of writing them. `writeSkills()` and `writeSkillsFromSnapshot()` are unchanged: they still replace the dedicated `skills` output directory.
  
  ### @crustjs/extensions
  
  The `completion()` build hook returns the three shell scripts instead of writing them. The runtime `completion <shell> --output-dir` command still writes all three files.

### Patch Changes

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Validate package identity before clearing build staging and preflight publish metadata, canonical containment, and directory uniqueness before invoking npm. Reject unexpected artifact links and nonregular files, case-insensitive cross-entry collisions, and malformed or legacy Build Reports. Core, tooling, and build-hook Extensions must use the coordinated pure-return build API; no legacy writer compatibility is added.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject duplicate staged package identities and case-only artifact directory aliases before publishing or completing builds. Validate subprocess report IDs and require reported paths to name contained regular files without treating reports as a complete side-effect inventory.
- Updated dependencies [[`c15d855`](https://github.com/chenxin-yan/crust/commit/c15d855b43d55605a310719c63f50d89c23a416d), [`955f85c`](https://github.com/chenxin-yan/crust/commit/955f85c130400c7c8d0e63efa9b16807482dba3e), [`e450975`](https://github.com/chenxin-yan/crust/commit/e450975f70d9dffda5fe068b55d56c48eb17ab44), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`33cd937`](https://github.com/chenxin-yan/crust/commit/33cd93792366803f2b33fac16fc4ab99057f9b0b), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`19c99e7`](https://github.com/chenxin-yan/crust/commit/19c99e77ffcff792527064354b2c5b9d756c51df), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3), [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3), [`1a919d7`](https://github.com/chenxin-yan/crust/commit/1a919d773f592cab65afd8d8f437c7947016523d)]:
  - @crustjs/core@0.3.0
  - @crustjs/extensions@0.3.0
  - @crustjs/style@0.3.2

## 0.2.1

### Patch Changes

- [#371](https://github.com/chenxin-yan/crust/pull/371) [`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the supported Bun floor to 1.4.0.
  
  Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.

- [#369](https://github.com/chenxin-yan/crust/pull/369) [`aea775a`](https://github.com/chenxin-yan/crust/commit/aea775a54ae0a891e9ef7547171aadcd3e0abe17) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add musl Linux targets and drop the legacy `-baseline` target names.
  
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

- [#370](https://github.com/chenxin-yan/crust/pull/370) [`0f43a93`](https://github.com/chenxin-yan/crust/commit/0f43a93aeade7a354d40540a2c08b1af7555e462) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `crust build` gains a repeatable `--bun-plugin <specifier>` flag that loads Bun bundler plugins from your project (default export) for Bun standalone and Node builds — for example `crust build --bun-plugin @opentui/solid/bun-plugin` compiles OpenTUI Solid apps. Deno builds reject the flag.
  
  Compiled executables no longer load the `bunfig.toml` of the directory they start in (`--no-compile-autoload-bunfig`), so a project `preload` such as `@opentui/solid/preload` can no longer crash your binary — or `crust` itself — before your code runs. `.env` autoloading is unchanged.
  
  Without a separate `bun` on `PATH`, `crust build` on arm64 hosts refuses a build whose targets include the host's own target (e.g. `bun-darwin-arm64` on Apple silicon): Bun would compile it by copying the running `crust` executable onto itself and emit a binary that crashes on start. The error names the other targets so you can rerun with explicit `--target`; install Bun to build the host target. On x64 hosts the same target is compiled through Bun's `-baseline` alias, which Bun downloads clean, so it builds without Bun installed.

## 0.2.0

### Minor Changes

- [#360](https://github.com/chenxin-yan/crust/pull/360) [`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Attribute files returned by Extension build hooks to their Extension ids, transport the Build Report to `crust build`, and print a concise per-hook artifact summary before compilation.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Extension build hooks, multi-runtime builds, and snapshot-based man pages.
  
  - `crust build` runs registered Extension build hooks in registration order, refreshing the root snapshot between hooks. `--no-validate` skips entry preparation and all hooks. Entries that never reach `await app.execute()` now fail with a missing-snapshot error instead of passing validation vacuously; use `--no-validate` if intentional.
  - Choose Bun, Deno, or Node with `--runtime` or package.json's `crust.runtime`. Deno produces standalone executables with all permissions (`-A`); `--package`, `--minify`, and `--env-file` are unsupported. Node produces one executable JavaScript bundle with a Node shebang; `--target` and `--package` are unsupported.
  - `--target` requires canonical compiler names. Replace `linux-x64`/`darwin-arm64` with `bun-linux-x64-baseline`/`bun-darwin-arm64`; Deno uses triples such as `aarch64-apple-darwin`. Unknown targets suggest canonical spellings.
  - `crust build --package` stages every top-level artifact directory emitted by hooks; `bin` is reserved for npm executables. License copying selects the first existing `LICENSE`, `LICENSE.md`, `LICENCE`, or `LICENCE.md`, including it in root and platform packages.
  - Windows `.cmd`/`.bat` subprocess shims run through the platform shell, allowing builds under Node's CVE-2024-27980 hardening.
  - `@crustjs/man` adds the build-only `man(options?)` Extension and `ManOptions`. It writes `<outdir>/man/<name>.<section>`; section defaults to 1, with `name`/`section` overrides. For custom pipelines, migrate `writeManPage({ app, ... })` to `writeManPage({ root: await app.snapshot(), ... })`; `argv` and `logWarnings` options are removed. `renderManPageMdoc()` now takes a `CommandSnapshot` as `root` instead of `CommandNode`.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update runtime compatibility and package builds.
  
  - Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
  - Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
  - Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.

## 0.0.24

### Patch Changes

- 9db2613: Make build-validation mode safe for in-process callers.

  `Crust.execute()` no longer calls `process.exit()` when only
  `CRUST_INTERNAL_VALIDATE_ONLY=1` is set — it now runs the validation
  pipeline, surfaces errors via stderr and `process.exitCode`, and returns
  like the rest of `.execute()`'s error paths. Process termination is
  opt-in via the new `CRUST_INTERNAL_VALIDATE_FORCE_EXIT=1` env var, which
  `crust build`'s `validateEntrypoint()` sets on its spawned subprocess.

  For end users there is no change: `crust build` now sets both env vars on
  its validation subprocess, preserving the existing behavior of skipping
  entrypoint code after `await app.execute()` during the build check.
  Tests and embedders that need to exercise the validation pipeline can
  now do so without being terminated.

## 0.0.23

### Patch Changes

- f457387: Prefer spawning real `bun build --compile` over in-process `Bun.build()` to avoid standalone compiler failures on some host/target combinations.
  - Add `resolveBunBuildRunner()` to prefer the real Bun binary on PATH, falling back to `process.execPath` with `BUN_BE_BUN=1` only when needed
  - Update `execBuild()` to always use subprocess compilation instead of the programmatic API
  - Improve error reporting by surfacing both stdout and stderr from failed builds
  - Add unit tests for the new runner resolution logic
  - Update documentation to reflect the new build behavior

## 0.0.22

### Patch Changes

- 662c53c: migrate to use js resolver instead of shell resolver so that it will expose single entry point

## 0.0.21

### Patch Changes

- 1433928: Add `--env-file` flag to `crust build` for loading environment files at build time. Public env vars (PUBLIC\_\*) are automatically inlined as build-time constants.
- 86e09aa: Rename `--distribute` build flag to `--package` across CLI, templates, and docs

## 0.0.20

### Patch Changes

- a69c4d9: Add per-platform npm distribution workflow with `crust build --distribute` and `crust publish` commands. The build command now supports `--distribute` and `--stage-dir` flags to stage per-OS/arch npm packages with platform-specific binaries and shell/cmd resolvers. The new `publish` command publishes staged packages in dependency order. Updated `create-crust` binary distribution template to use the new distribute/publish workflow.

## 0.0.19

### Patch Changes

- 38cdb75: Fix Windows ARM64 binary never selected in .cmd resolver due to CMD parse-time variable expansion

## 0.0.18

### Patch Changes

- 254b262: Add Windows ARM64 support to `crust build` and update distribution outputs.
  - `crust build` now supports `windows-arm64` (`bun-windows-arm64`) as a compile target.
  - Windows resolver generation now selects the correct binary for ARM64 and x64 hosts.
  - Binary distribution templates and package metadata now explicitly include resolver files and compiled binaries.
  - Build docs were updated to include the new Windows ARM64 target and output artifact.

## 0.0.17

### Patch Changes

- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
- Updated dependencies [7dc9ede]
  - @crustjs/core@0.0.11
  - @crustjs/plugins@0.0.14

## 0.0.16

### Patch Changes

- Updated dependencies [1715c81]
  - @crustjs/plugins@0.0.13

## 0.0.15

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10
  - @crustjs/plugins@0.0.12

## 0.0.14

### Patch Changes

- cae6ea2: Add `updateNotifierPlugin` to `@crustjs/plugins`. The plugin checks the npm registry for newer versions of your package and displays a non-blocking update notice after command execution. It is non-persistent by default, supports optional cache adapters (including `@crustjs/store`) for cross-run caching and dedupe, and uses package-manager-aware update commands with override support. Adopted in the `crust` CLI and the `create-crust` scaffold template by default.
- Updated dependencies [cae6ea2]
  - @crustjs/plugins@0.0.11

## 0.0.13

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- e3624b2: Add pre-compile validation to `crust build`. Before compiling, the build command now spawns your entry file in a validation-only subprocess to check the full command tree (including plugin-injected flags and subcommands) for definition errors such as flag alias collisions and reserved `no-` prefix misuse. Disable with `--no-validate`.
- Updated dependencies [a1f233e]
- Updated dependencies [e3624b2]
  - @crustjs/core@0.0.9
  - @crustjs/plugins@0.0.10
  - @crustjs/style@0.0.4

## 0.0.12

### Patch Changes

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8
  - @crustjs/plugins@0.0.9

## 0.0.11

### Patch Changes

- Updated dependencies [1364768]
  - @crustjs/core@0.0.7
  - @crustjs/plugins@0.0.8

## 0.0.10

### Patch Changes

- Updated dependencies [fe4d64d]
  - @crustjs/plugins@0.0.7

## 0.0.9

### Patch Changes

- 2d05fb1: Fix shell resolver failing to locate prebuilt binaries when invoked via symlink (e.g. from `node_modules/.bin/`). The resolver now follows symlinks to resolve the real script directory before looking up platform binaries.

## 0.0.8

### Patch Changes

- 8c11cd0: Replace `Bun.spawn` with programmatic `Bun.build()` API for compilation, enabling self-compiled standalone crust binaries that can compile user CLIs without a separate Bun installation. Add `--outdir/-d` flag for configurable output directory. Update resolver shebang to `#!/usr/bin/env bash`.

## 0.0.7

### Patch Changes

- b415f81: **BREAKING:** Remove re-exports from `@crustjs/crust` — it is now a CLI-only package.

  `@crustjs/crust` no longer re-exports APIs from `@crustjs/core` and `@crustjs/plugins`. It now provides only the `crust` CLI binary (e.g., `crust build`) and should be installed as a dev dependency. Import framework APIs directly from `@crustjs/core` and `@crustjs/plugins` instead.

  Migration: replace `import { defineCommand, runMain, helpPlugin } from "@crustjs/crust"` with `import { defineCommand, runMain } from "@crustjs/core"` and `import { helpPlugin } from "@crustjs/plugins"`. Move `@crustjs/crust` to `devDependencies` and add `@crustjs/core` + `@crustjs/plugins` to `dependencies`.

- 3b00b1d: Add `--resolver` (`-r`) flag to `crust build` for customizing the resolver script filename. Defaults to `cli` instead of `<name>.js`.
- 717180a: Replace Node.js resolver with POSIX shell script and Windows `.cmd` batch file for multi-target builds. The resolver no longer requires Node.js or Bun to dispatch to the correct platform binary.

## 0.0.6

### Patch Changes

- Updated dependencies [8c23587]
  - @crustjs/core@0.0.6
  - @crustjs/plugins@0.0.6

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish
- Updated dependencies [8e0b48a]
  - @crustjs/core@0.0.5
  - @crustjs/plugins@0.0.5

## 0.0.4

### Patch Changes

- dcc258c: switch to use literal string for flags and args types
- Updated dependencies [115d396]
- Updated dependencies [9b951e9]
- Updated dependencies [bdd101f]
- Updated dependencies [dcc258c]
  - @crustjs/core@0.0.4
  - @crustjs/plugins@0.0.4

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
- Updated dependencies
  - @crustjs/core@0.0.3
  - @crustjs/plugins@0.0.3
