# @crustjs/plugins

## 0.6.0

### Minor Changes

- [#553](https://github.com/chenxin-yan/crust/pull/553) [`6a7e073`](https://github.com/chenxin-yan/crust/commit/6a7e073c4cb59452a03f41cbe656fd03e2b56dc9) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Listing commands no longer builds them. In `ctx.rootCommand`, `ctx.command`, and `COMMAND_NOT_FOUND` details, a child that has not been built exposes its `defineCommand()` metadata (`name`, `description`, `aliases`, `hidden`, `usage`) without running its recipe. Reading its `meta.sections`, `hasAction`, `args`, `flags`, or `subCommands` builds it. `help()` lists subcommands from that metadata, and an unknown command no longer builds the parent's whole subtree. Root `--help` on a 200-command CLI now runs no command recipes.
  
  **Behavior change:** a command whose recipe throws no longer breaks root help or unknown-command reporting. `cli --help` still lists it, and `cli typo` reports `Unknown command "typo"`, with a `didYouMean()` suggestion, instead of the unrelated recipe error. The broken command still fails when it is run or when `app.snapshot()`, `crust build`, or its own help reads it. On a child that has not been built, `meta.sections` is an accessor, so the key is present even when its value is `undefined`. `app.snapshot()` is unchanged: it builds and validates the full tree.

- [#519](https://github.com/chenxin-yan/crust/pull/519) [`29d07af`](https://github.com/chenxin-yan/crust/commit/29d07afabce709506fee35261bf035799de33abb) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `completion()` and `skill()` no longer switch off type checking of the host's command tree. After `.extend(completion())` or `.extend(skill({}))`, `app.run()` and `runInteractive()` again reject misspelled command paths and flags, and the contributed command itself is typed (`completion`'s `<shell>` choices, the `skills` subcommands, flags, and default `skill` alias). A literal `command` option is kept as the contributed name; a `command` typed as `string`, or one that may be absent, leaves the tree unchecked, as before. A host command that already uses the contributed name is now reported at compile time, like other Extension command collisions.

- [#563](https://github.com/chenxin-yan/crust/pull/563) [`0ab1ca1`](https://github.com/chenxin-yan/crust/commit/0ab1ca1e69caa38a872a2cf36266b200664d5228) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `completion()` now requires root `version` metadata at compile time, like `version()` and `updateNotifier()`, unless it is given a string `version` option. It already threw when a script was rendered without one. To migrate, pass `new Crust(name, { version })` or `completion({ version })`.

- [#603](https://github.com/chenxin-yan/crust/pull/603) [`0a2c6b1`](https://github.com/chenxin-yan/crust/commit/0a2c6b198b07b693789f10a4c0532f27b94a6a9d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `help()`, `version()`, and `noColor()` now behave the same in any `.extend()` order. `--help --version` prints help and `--version --help` prints the version, `deploy --preview --help` shows help even when another Extension handles `--preview`, and `--no-color` or `--color` applies to help output whether or not `noColor()` was registered first.

- [#534](https://github.com/chenxin-yan/crust/pull/534) [`e9c5af3`](https://github.com/chenxin-yan/crust/commit/e9c5af35ae43d934a30da9b88528df35e1e75f85) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Importing an Extension now loads only its registration; renderers, completion scripts, update checks, and typo suggestions load the first time they run, so a CLI that never prints help or completion never pays for `@crustjs/style` or the shell templates at startup.
  
  **Breaking:** `renderHelp`, `renderBashCompletion`, `renderZshCompletion`, and `renderFishCompletion` now return `Promise<string>`.
  
  ```diff
  - const text = renderHelp(await app.snapshot());
  + const text = await renderHelp(await app.snapshot());
  ```

- [#559](https://github.com/chenxin-yan/crust/pull/559) [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Drop runtime checks that only inputs bypassing the types could reach. Runtime checks now cover only values TypeScript can't see, such as names typed `string`, spread arrays, and `Record` definitions. Breaking only for callers that bypass the types (`as never`, `any`, or plain JavaScript):
  
  - `defineCommand()` without a recipe no longer throws a `DEFINITION` error (`missing-recipe`); the command fails with a `TypeError` when it is first built.
  - `version()` and `updateNotifier()` no longer throw when neither the call nor the root metadata supplies a version.
  
  `"missing-recipe"` is removed from `DefinitionErrorReason`.
  
  Runtime checks still reject a documentation section with both `only` and `except`, a flag `env` that is not `{ name: string, delimiter?: string }` (`invalid-env`), and a `delimiter` or `env.delimiter` on a flag without `multiple: true` (`delimiter-without-multiple`). Structural views can hide these properties from TypeScript without removing them at runtime.

- [#521](https://github.com/chenxin-yan/crust/pull/521) [`51f16e7`](https://github.com/chenxin-yan/crust/commit/51f16e725216e8c064408c97613cab91f6d6bf56) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `updateNotifier()` now skips the update check entirely (no cache read, network request, or notice) when `CI` is set (other than `0`/`false`), when `NO_UPDATE_NOTIFIER` is non-empty, or when `process.stderr` is not a TTY. Calling `updateNotifier()` without a string `currentVersion` now requires root `version` metadata at compile time, matching `version()`. Extension factories are marked `/* @__PURE__ */` so bundlers drop unused extensions, and `renderHelp()` no longer documents grandchildren it never prints.

### Patch Changes

- [#539](https://github.com/chenxin-yan/crust/pull/539) [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove the `engines.deno` declaration; Deno is no longer supported.

- [#579](https://github.com/chenxin-yan/crust/pull/579) [`ff5b5d4`](https://github.com/chenxin-yan/crust/commit/ff5b5d4e02dd039875170c96734d5cad9485553d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Help shows what a value flag takes. `help()` prints the flag's type after its spellings, such as `-c, --count <number>`, and generated man pages add the matching argument (`-c, --count number`). Boolean flags are unchanged. Choices, defaults, and env variables still appear after the description. A label wider than its column now widens the column instead of pushing its description out of line.

- [#558](https://github.com/chenxin-yan/crust/pull/558) [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Start faster on Node. Core, Extensions, and utils load Node built-ins with `process.getBuiltinModule()` where they are used instead of static `node:*` imports, which made Node evaluate every lazy export of `node:fs` and `node:util` at startup. `node:stream`, which is expensive to load on Bun, now loads only for `run()` and for `execute()` with injected `io`.

- [#532](https://github.com/chenxin-yan/crust/pull/532) [`3a6dbb1`](https://github.com/chenxin-yan/crust/commit/3a6dbb1702cff684c17054cd476ddef0b5d56f99) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `packageManagerFromUserAgent` and `PackageManager` moved from `@crustjs/utils/process` to the new `@crustjs/utils/package-manager`, which does not load `child_process`, so `updateNotifier()` no longer pays for it at startup.
- Updated dependencies [[`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`6a7e073`](https://github.com/chenxin-yan/crust/commit/6a7e073c4cb59452a03f41cbe656fd03e2b56dc9), [`a805be3`](https://github.com/chenxin-yan/crust/commit/a805be3923e60e64e34fb3ac49a41b9f4b7cf71a), [`fd54147`](https://github.com/chenxin-yan/crust/commit/fd541473c362c3f0c1054513ca00bbd681287d78), [`3c78cc9`](https://github.com/chenxin-yan/crust/commit/3c78cc9cc461be383551f599e838cb1e7253a4a1), [`4f4d9e9`](https://github.com/chenxin-yan/crust/commit/4f4d9e9eb44a7f43577bfd883ae7959dd112ac64), [`8bf19e2`](https://github.com/chenxin-yan/crust/commit/8bf19e2627ccf49a74792ae84d363718ebc04b9f), [`cc3048c`](https://github.com/chenxin-yan/crust/commit/cc3048cb281e4f6cf556e81ed7358d7e2fb0e52c), [`484e055`](https://github.com/chenxin-yan/crust/commit/484e0552aeadbaa4103bc61553f1183ee25b212c), [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7), [`6e4e59b`](https://github.com/chenxin-yan/crust/commit/6e4e59bfa71d72daf39ceebc752e27d29b0449af), [`014d5aa`](https://github.com/chenxin-yan/crust/commit/014d5aa41499d1a0cc69f83589a0ff7a0f0432c7), [`46ab354`](https://github.com/chenxin-yan/crust/commit/46ab3549974b98b36329471cf212e3171e8fdf5e), [`da6dace`](https://github.com/chenxin-yan/crust/commit/da6dacef13b95abcbe5472ebaf1de441cddb0003), [`0a2c6b1`](https://github.com/chenxin-yan/crust/commit/0a2c6b198b07b693789f10a4c0532f27b94a6a9d), [`8544498`](https://github.com/chenxin-yan/crust/commit/854449869f795f00505952dc04d653f2e7f6f923), [`d5a9522`](https://github.com/chenxin-yan/crust/commit/d5a9522f11836b7c6beac79901f87f6d74d608a2), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`7e2da48`](https://github.com/chenxin-yan/crust/commit/7e2da482af5a21d27a2d32839a051cc6e0c36974), [`e974d05`](https://github.com/chenxin-yan/crust/commit/e974d05834785604ed16551613baec9e7a961c4a), [`9592652`](https://github.com/chenxin-yan/crust/commit/95926524d877ebc6d20307095408bac2f5fa95d4), [`0ab1ca1`](https://github.com/chenxin-yan/crust/commit/0ab1ca1e69caa38a872a2cf36266b200664d5228), [`8ff9c6a`](https://github.com/chenxin-yan/crust/commit/8ff9c6abeaf3b89adb90f72c533d98d5c13ccce9), [`48823e8`](https://github.com/chenxin-yan/crust/commit/48823e82c50f583b990b99f49f5441bcf0280723), [`09a6808`](https://github.com/chenxin-yan/crust/commit/09a68080e8809b507dbcd0c581bd9942b186f44b), [`02993c7`](https://github.com/chenxin-yan/crust/commit/02993c71a43cafa1cbbd9853bf00e991efccb1cb), [`3273ceb`](https://github.com/chenxin-yan/crust/commit/3273ceb045554c446ac7da4937885700bf349d17), [`97e8def`](https://github.com/chenxin-yan/crust/commit/97e8def311a44507f4c06f16843f840bfa587d12), [`d863ca6`](https://github.com/chenxin-yan/crust/commit/d863ca674800fe6a1595187378129c2bef86a9f6), [`75555f3`](https://github.com/chenxin-yan/crust/commit/75555f37d8624114c02cf8af3cace0e6826aef02), [`34df0c6`](https://github.com/chenxin-yan/crust/commit/34df0c604910ceab083a7e88910cc510da4a5c5a), [`d8f8062`](https://github.com/chenxin-yan/crust/commit/d8f8062ff67fb9ad31f8134b3ee59209325de75f), [`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`27f5832`](https://github.com/chenxin-yan/crust/commit/27f583260be2ad90544dd85d5653f7ab23255cff), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d), [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073), [`3f0db61`](https://github.com/chenxin-yan/crust/commit/3f0db6189a1e33d3c5e9dbee44624feadc8a7cb0), [`aad9c15`](https://github.com/chenxin-yan/crust/commit/aad9c156dd89b3283e73cb420aac724d2f3598eb), [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761), [`4e2c3d7`](https://github.com/chenxin-yan/crust/commit/4e2c3d73577561d447e0ef58f7fc521b8a6fa3fa), [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d), [`4a4386d`](https://github.com/chenxin-yan/crust/commit/4a4386d64fdef5440e77cebd8b9ac85e7a1d7350), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`0cf0914`](https://github.com/chenxin-yan/crust/commit/0cf091408ad9e1251b6e8f42712b20299e591309), [`71cd6dd`](https://github.com/chenxin-yan/crust/commit/71cd6dd8b0e5af788e11ccd68616b3c7b1c693ba), [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19), [`e802ec7`](https://github.com/chenxin-yan/crust/commit/e802ec7c09c6635d77716e3c1c545faa99fe7759), [`db2f5b3`](https://github.com/chenxin-yan/crust/commit/db2f5b391ccbcc6750e98e9219511ecf0820baf6), [`6ef96cd`](https://github.com/chenxin-yan/crust/commit/6ef96cdc8349991ca77360e906f6ae56863cc38b), [`bc85878`](https://github.com/chenxin-yan/crust/commit/bc858780958074fad17424509e5a4190e5e7d468), [`f49de57`](https://github.com/chenxin-yan/crust/commit/f49de57eb0d77220617792669fb185f1e20e656d), [`6ce95ed`](https://github.com/chenxin-yan/crust/commit/6ce95edb85095d8e8c3ab27fed8226d320fc3d82), [`7811b12`](https://github.com/chenxin-yan/crust/commit/7811b12f73827e1d47a1574c4b88736eb82632b0), [`3a6dbb1`](https://github.com/chenxin-yan/crust/commit/3a6dbb1702cff684c17054cd476ddef0b5d56f99)]:
  - @crustjs/utils@0.3.0
  - @crustjs/store@0.5.0
  - @crustjs/core@0.6.0
  - @crustjs/style@0.4.0

## 0.5.6

No changes in this release.

## 0.5.5

No changes in this release.

## 0.5.4

### Patch Changes

- [#484](https://github.com/chenxin-yan/crust/pull/484) [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `completion()` now validates the root command name with the installed command name rule shared with `crust build`, and its error states that rule (letters, digits, `.`, `_`, and `-`, starting with a letter or digit). Accepted names are unchanged.

- [#484](https://github.com/chenxin-yan/crust/pull/484) [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Shell completion now reads every flag spelling from Core's documentation model. Bash and zsh offer `-P` for a one-character alias and route past its value (`mycli -P 9090 serve <Tab>` completes `serve`'s subcommands), and fish offers `-P` as a short option.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Generated completion scripts now name the configured `completion({ command })` subcommand in their "regenerate with" header.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Completion validation errors now quote the exact pattern enforced for choice values and identifiers, including the required alphanumeric first character.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `updateNotifier` now resolves `updateCommand` (including callbacks and package-manager detection) only when it shows an update notice.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Zsh completion now shows flag descriptions containing apostrophes (e.g. "Don't prompt") correctly instead of escaping them twice.
- Updated dependencies [[`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14)]:
  - @crustjs/store@0.4.4
  - @crustjs/style@0.3.6

## 0.5.3

### Patch Changes

- Updated dependencies [[`eca2876`](https://github.com/chenxin-yan/crust/commit/eca287680727e32da4b2770782342969398f7f09)]:
  - @crustjs/utils@0.2.2

## 0.5.2

### Patch Changes

- [#478](https://github.com/chenxin-yan/crust/pull/478) [`3696635`](https://github.com/chenxin-yan/crust/commit/36966358ad7a9c6b25dfdbef83bffc2a7c981e29) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove the `man({ name })` and `completion({ binName })` options, and the `name` option of `renderManPageMdoc()` and `writeManPage()`. Man pages and completion scripts now always use the root command name, which `crust build` already requires to match the installed command. To change the installed name, rename the root: `new Crust("my-tool")`.

- [#477](https://github.com/chenxin-yan/crust/pull/477) [`6323fac`](https://github.com/chenxin-yan/crust/commit/6323facd4c45ea7b478576006f013cf7797d4116) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `version()` without a value now throws a `DEFINITION` error on `--version` when the root has no `version` metadata, instead of printing `undefined`. TypeScript already rejects this setup; the runtime check covers builds that skip type-checking.

## 0.5.1

### Patch Changes

- [#469](https://github.com/chenxin-yan/crust/pull/469) [`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the minimum supported Node.js version to 24. Remove the Node 22 disposal-stack fallback and use native AsyncDisposableStack on all supported runtimes. Update generated Node projects to require Node 24 and use @types/node 24.
- Updated dependencies [[`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b)]:
  - @crustjs/store@0.4.3
  - @crustjs/style@0.3.5
  - @crustjs/utils@0.2.1

## 0.5.0

### Patch Changes

- [#464](https://github.com/chenxin-yan/crust/pull/464) [`1a9004f`](https://github.com/chenxin-yan/crust/commit/1a9004f94c65380a750b1461f3f24a18f521644f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix fish completion routing when value-taking flags appear with separate values before subcommands or between positionals
- Updated dependencies [[`bc3cbb2`](https://github.com/chenxin-yan/crust/commit/bc3cbb250974fcdba4ce2f50ee4b6b90a1f16c30), [`0da2c5c`](https://github.com/chenxin-yan/crust/commit/0da2c5ce54f71acc5d51fad1dcb2c5546a71948e), [`c4f44d6`](https://github.com/chenxin-yan/crust/commit/c4f44d6f9e3dd206154d0b18a84fb75464dc2dfe), [`c6f4bd8`](https://github.com/chenxin-yan/crust/commit/c6f4bd8f3de3558d9c988acf63830ec899cf6854), [`4360cb1`](https://github.com/chenxin-yan/crust/commit/4360cb1cefca245e76967ade43c82b5361c039e5), [`fe08f18`](https://github.com/chenxin-yan/crust/commit/fe08f1887a7b36e68741102c0c7d0586b5a12a35), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93), [`0b835c2`](https://github.com/chenxin-yan/crust/commit/0b835c20b9bcf09e9dea7f179eeecd43a9c50763), [`eb9928d`](https://github.com/chenxin-yan/crust/commit/eb9928d60edc3033652ad55a3a019e790dafdf06), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93)]:
  - @crustjs/core@0.5.0
  - @crustjs/utils@0.2.0
  - @crustjs/style@0.3.4
  - @crustjs/store@0.4.2

## 0.4.1

No changes in this release.

## 0.4.0

### Minor Changes

- [#438](https://github.com/chenxin-yan/crust/pull/438) [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `env: { name, delimiter? }` and `delimiter` to `FlagDef`. A flag with `env` reads the named environment variable when absent from argv (argv > env > `default`); the value goes through the same coercion, `choices`, `parse`, and schema path as an argv token and satisfies `required`. Flag-level `delimiter` splits string argv occurrences; `env.delimiter` independently splits environment text. Both require repeatable flags and drop empty segments, with no implicit separator inheritance. `FlagSnapshot`/`DocumentationFlag` carry the immutable environment binding and argv delimiter; help and generated man pages render `[env: NAME]` after the description and never the value. `formatDescription` accepts an optional trailing `env` argument. Structured `run()` input does not read the environment and is never split.

### Patch Changes

- Updated dependencies [[`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb), [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb)]:
  - @crustjs/core@0.4.0

## 0.3.6

No changes in this release.

## 0.3.5

No changes in this release.

## 0.3.4

No changes in this release.

## 0.3.3

No changes in this release.

## 0.3.2

### Patch Changes

- [#411](https://github.com/chenxin-yan/crust/pull/411) [`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Depend on the published `@crustjs/utils` package instead of inlining its sources into the bundle.
- Updated dependencies [[`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7), [`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7)]:
  - @crustjs/store@0.4.1
  - @crustjs/utils@0.1.0

## 0.3.1

### Patch Changes

- [#400](https://github.com/chenxin-yan/crust/pull/400) [`d5937f8`](https://github.com/chenxin-yan/crust/commit/d5937f843240e0244a542e5c294bcfc4f16574ff) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `noColor`: overlapping programmatic runs with opposing `--color`/`--no-color` flags now fail fast in `preRun` instead of last-writer-wins on `process.env`.
- Updated dependencies [[`4350974`](https://github.com/chenxin-yan/crust/commit/4350974af6b81ce9f0db1e3951cdf8b7b0b43b3d)]:
  - @crustjs/style@0.3.3

## 0.3.0

### Minor Changes

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

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix generated shell completions: Bash `path` value completion now keeps filenames containing spaces or glob characters as single candidates (and asks readline to quote them), and Zsh helper functions use an injective `_<bin>__<segment>` encoding so distinct commands such as `foo-bar` and `foo_bar` no longer overwrite each other's completions. Regenerate saved completion scripts.
- Updated dependencies [[`c15d855`](https://github.com/chenxin-yan/crust/commit/c15d855b43d55605a310719c63f50d89c23a416d), [`955f85c`](https://github.com/chenxin-yan/crust/commit/955f85c130400c7c8d0e63efa9b16807482dba3e), [`e450975`](https://github.com/chenxin-yan/crust/commit/e450975f70d9dffda5fe068b55d56c48eb17ab44), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`33cd937`](https://github.com/chenxin-yan/crust/commit/33cd93792366803f2b33fac16fc4ab99057f9b0b), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`19c99e7`](https://github.com/chenxin-yan/crust/commit/19c99e77ffcff792527064354b2c5b9d756c51df), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3), [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3), [`1a919d7`](https://github.com/chenxin-yan/crust/commit/1a919d773f592cab65afd8d8f437c7947016523d)]:
  - @crustjs/core@0.3.0
  - @crustjs/store@0.4.0
  - @crustjs/style@0.3.2

## 0.2.1

### Patch Changes

- [#371](https://github.com/chenxin-yan/crust/pull/371) [`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the supported Bun floor to 1.4.0.
  
  Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.
- Updated dependencies [[`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d)]:
  - @crustjs/store@0.3.1
  - @crustjs/style@0.3.1

## 0.2.0

### Minor Changes

- [#345](https://github.com/chenxin-yan/crust/pull/345) [`6afef3d`](https://github.com/chenxin-yan/crust/commit/6afef3d3ca04bd941507298d074d1b54a775c54a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Official Extensions require a caret-compatible `@crustjs/core` peer (`^0.2.0` for this release), excluding older incompatible core APIs rather than accepting all 0.x versions.

- [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `@crustjs/extensions` replaces `@crustjs/plugins`. Import everything from the package root and register with `.extend()`: `helpPlugin` → `help`, `versionPlugin` → `version`, `completionPlugin` → `completion`, `didYouMeanPlugin` (and deprecated `autoCompletePlugin`) → `didYouMean`, `noColorPlugin` → `noColor`, `updateNotifierPlugin` → `updateNotifier`. Factories expose `.id` for section audiences.
  
  - `help()` lists every accepted spelling, including all long-alias negations (`-v, --verbose, --loud, --no-verbose, --no-loud`); `noNegate` flags show no negation.
  - `version(value?, options?)` defaults to root `version` metadata and prints `<name> v<version>`. `format: "plain"` prints the bare version; a `(version, context) => string` callback customizes the line.
  - `completion(options?)` defaults `binName` to the root name and `version` to root version metadata; missing versions fail with `DEFINITION`. `completion <shell> --output-dir <dir>` writes all three shells (`<bin>`, `_<bin>`, `<bin>.fish`); the `shells` option is removed. Its build hook writes the same files to `<outdir>/completions/`, staged by `crust build --package`. `renderBashCompletion`, `renderZshCompletion`, `renderFishCompletion`, and `CompletionRenderOptions` support custom pipelines.
  - `noColor()` scopes standard environment variables instead of only toggling `@crustjs/style`: `--color` sets `FORCE_COLOR=3` and clears `NO_COLOR`; `--no-color` sets `NO_COLOR=1` and clears `FORCE_COLOR`. Previous values are restored after execution, so child processes and other color-aware libraries comply.
  - `updateNotifier()` follows SemVer precedence, including prerelease-to-stable notifications. `currentVersion` defaults to root version metadata. Persistence is on by default through the runtime dependency `@crustjs/store`, in the platform state directory for `packageName`. Use `cache: false` to opt out, `cache: { intervalMs }` to tune checks, or `cache: { adapter }` for custom storage. Corrupt caches are treated as empty and repaired after a successful check.
  - Update notices are command-less unless `updateCommand` supplies a string, a `({ packageName, packageManager }) => string` callback, or `{ scope: "global" | "local" }`. Migrate positional callback arguments to that object; `updateDocsUrl` adds a documentation link. The separate `packageManager`/`installScope` options and `UpdateNotifierInstallScope` type are removed.
  - Option types are renamed: `CompletionPluginOptions` → `CompletionOptions`, `DidYouMeanPluginOptions`/`AutoCompletePluginOptions` → `DidYouMeanOptions`, and `UpdateNotifierPluginOptions` → `UpdateNotifierOptions`. New root type exports include `VersionOptions`, `UpdateCommandResolver`, and `UpdateNotifierState`.

- [#354](https://github.com/chenxin-yan/crust/pull/354) [`cb0e9f1`](https://github.com/chenxin-yan/crust/commit/cb0e9f1f0538c0576505534d429566ed29bcb996) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add curried, extension-owned root metadata requirements with defineExtension<"version">()(id, configOrFactory). Required keys refine hook and artifact snapshots and are checked by strict TypeScript when installing extensions. version() now requires guaranteed root version metadata unless an explicit string or lazy provider is supplied; remove its runtime missing-version error. Keep ordinary defineExtension calls unchanged and put scaffold versions in root metadata. Root metadata now rejects statically known extra keys on pretyped objects as well as fresh literals; generic wrappers must also establish that their metadata contains only root keys.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update runtime compatibility and package builds.
  
  - Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
  - Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
  - Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.

### Patch Changes

- [#360](https://github.com/chenxin-yan/crust/pull/360) [`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Attribute files returned by Extension build hooks to their Extension ids, transport the Build Report to `crust build`, and print a concise per-hook artifact summary before compilation.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Default `ExtensionFactory` dependency, provider, flag, and command parameters to closed contribution sets. Published factories can now omit empty trailing type arguments; explicitly use the broad upper-bound type for namespaces that must remain open.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Automatically validate observable constraints at authoring, preparation, deferred definition consumption, and invocation. Dynamic names and collections use the same APIs; spread collections into variadic builder methods. Consume deferred Extension factory/section results when produced and verify declared Context availability without constructing Contexts.
  
  Keep known invocation contracts strict: literal choices, required fields, supplied positional prefixes, nonempty required variadics, value kinds, and command paths retain compile-time checking. Fresh object literals reject typo keys alongside valid required fields; standard structural assignability still permits extra keys on predeclared objects. Schemas and custom parsers retain raw input contracts independently of their action output types.
  
  A bare `Crust` has an empty argument tuple. Prefer inferred authoring builders; `AnyCrust` is a completed-app inspection/invocation view with broad input and an unknown action result, not authoring authority. Dynamic/open shapes retain independently known fields, and uncertain unions retain conservative obligations. Broad string names work without wrappers; known-invalid union members remain rejected.
  
  Own normalized structural definition arrays without cloning JSON, URL, schema, callback, or Context-option payloads. Preserve Context/Extension defining data through structural copies, lazy setup, once-per-invocation resolution, replacement ordering, preRun/finish ordering, and cleanup. Keep static duplicate checks that protect earlier typed consumers; supported dynamic replacements retain last-write-wins. Supplied removed flag keys fail binding, but omitting a retired defaulted flag can still leave an earlier action observing undefined.
  
  Preserve TypeScript-owned metadata, dependency, and callback-value demands, including conditional/nested providers used by descendant hooks. Recipe-local duplicate Context checks use actual local providers rather than inherited/demanded names, allowing compatible local provisioning while rejecting incompatible values and repeated local providers. Preserve precise static Extension contributions and migrate configurable Completion/Skills callers to ordinary composition.
- Updated dependencies [[`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`38e7298`](https://github.com/chenxin-yan/crust/commit/38e7298954c60ec0a45dcfa830b515b2bc32ece0), [`59b8ec6`](https://github.com/chenxin-yan/crust/commit/59b8ec6ae3eae3da450d3297e375fee057296379), [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`cb0e9f1`](https://github.com/chenxin-yan/crust/commit/cb0e9f1f0538c0576505534d429566ed29bcb996), [`37a4ae1`](https://github.com/chenxin-yan/crust/commit/37a4ae15d7cc635406ad2f7643afaad6d7391e75), [`72b462e`](https://github.com/chenxin-yan/crust/commit/72b462e110c421ce453b7a2f81ef0e284f908607), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95)]:
  - @crustjs/core@0.2.0
  - @crustjs/store@0.3.0
  - @crustjs/style@0.3.0

## 0.1.2

### Patch Changes

- @crustjs/core@0.0.19

## 0.1.1

### Patch Changes

- c4d2b22: Completion templates now emit file completion for `type: "path"` flags and positional arguments (bash `compgen -f`, zsh `_files`, fish `__fish_complete_path`). File completion is explicitly suppressed for `type: "url"` and `type: "json"` flags/arguments — the existing string fallback used to offer filenames for any value-taking string flag, which is semantically wrong for URLs and JSON literals.
- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
- Updated dependencies [c4d2b22]
- Updated dependencies [c4d2b22]
  - @crustjs/core@0.0.18

## 0.1.0

### Minor Changes

- 8779692: Add `completionPlugin` for shell tab-completion.

  The new plugin registers a `completion <shell>` subcommand on the root command
  that emits a self-contained tab-completion script for **bash**, **zsh**, or
  **fish**. The strategy is **pure-static**: the plugin walks the live command
  tree at run time and prints a fully-baked script. There are no runtime
  callbacks, no hidden `__complete` subcommand, and no shell-out on TAB — the
  generated script is the artifact users install into their shell.

  ```ts
  import { Crust } from "@crustjs/core";
  import { completionPlugin } from "@crustjs/plugins";

  new Crust("my-cli")
    .use(completionPlugin({ version: "1.0.0" }))
    .command("build", (cmd) =>
      cmd
        .flags({
          target: { type: "string", choices: ["browser", "bun", "node"] },
        })
        .run(() => {})
    )
    .run(() => {});
  ```

  ```sh
  # Print to stdout — pipe into the shell's auto-discovery directory.
  my-cli completion bash > ~/.local/share/bash-completion/completions/my-cli

  # Or generate every supported shell at packaging time.
  my-cli completion bash --output-dir completions/
  # → completions/my-cli, completions/_my-cli, completions/my-cli.fish
  ```

  Highlights:

  - **All three shells from one walk.** The bash template ships a Cobra-style
    init shim so it works on systems without the `bash-completion` package
    (macOS default bash, Alpine, NixOS without the package), handles the
    `--` end-of-options terminator, the `--name=value` form, and value-flag
    context. The zsh template uses `_arguments -C` with `->state` subcommand
    routing and emits description-rich menus, including positional choices
    and `_files` fallback for free-form string flags. The fish template
    emits declarative `complete -c` rules gated on a per-script ordered
    path predicate that walks `commandline -opc` left-to-right — unlike
    fish's stock `__fish_seen_subcommand_from`, the predicate is order-
    sensitive, so nested commands that reuse names at different depths
    route correctly.
  - **Choices and aliases surface end-to-end.** Static enums declared via
    the `choices` field on `FlagDef`/`ArgDef` become value lists in the
    generated scripts (flags **and** the first positional arg, in all
    three shells). Command aliases (`meta.aliases`) are tab-completable
    and resolve to the canonical command's flags. Boolean toggles also
    surface their `--no-<name>` negation candidate (unless `noNegate: true`).
  - **Strict input validation.** Command names, flag names, flag aliases,
    short flags, arg names, and `binName` must match
    `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`. Choice values must match
    `/^[A-Za-z0-9][A-Za-z0-9_.+:@/-]*$/`. The plugin throws at `setup()`
    time with a clear error if any input falls outside this set, rather
    than silently mis-quote the generated script. Description text and the
    `version` string flow through per-shell escapes; control characters
    are scrubbed at the boundary so they cannot break out of comment lines.
    `binName` is additionally rejected if it contains path separators or
    `..`, and the `--output-dir` writer verifies that resolved paths stay
    inside the requested directory.
  - **`--output-dir` for distributors.** Writes all configured shells with
    the canonical filenames Homebrew, Nix, AUR, and Debian expect
    (`<bin>` for bash, `_<bin>` for zsh, `<bin>.fish` for fish) — no rename
    needed. Use the `shells` option to scope down.
  - **Drift is mitigated by versioned headers.** Each generated script's
    first line embeds the binary name and version, so users (and `diff`)
    spot stale completion files at a glance, with the regenerate command
    inline.

  Limitations (v1):

  - No dynamic value completion (per-flag/per-arg `complete?:` callbacks);
    intentionally deferred to a future minor bump. Adding them is
    non-breaking, so v1 ships pure-static today and grows into a hybrid later.
  - No PowerShell template (planned for v2).

- 8779692: Make the `choices`, `meta.aliases`, and `meta.hidden` contracts consistent
  across every consumer (help, did-you-mean, man, completion).

  A cross-consumer audit found three gaps:

  - `helpPlugin` rendered output omitted the `choices` list for both flags
    and positional args, so users could not discover valid values from
    `--help` without resorting to shell completion or source-reading.
  - `didYouMeanPlugin` and the `@crustjs/man` manpage generator both
    walked the command tree without filtering `meta.hidden: true`, so
    internal commands (e.g. `__complete`) leaked into typo suggestions,
    the "Available commands" fallback, and published man pages.
  - `@crustjs/man` omitted long flag aliases (`def.aliases`) and `choices`
    from the OPTIONS / ARGUMENTS sections, leaving the man page strictly
    less informative than `--help`.
  - The completion plugin's bash and fish templates only surfaced
    `choices` for the **first** positional argument; zsh respected every
    slot. Variadic-with-choices arguments and multi-positional commands
    silently fell through to file completion in bash/fish.

  Changes:

  - `helpPlugin` renders `[choices: a, b, c]` after the description for
    every flag and arg that declares a `choices` list, composed with
    `[default: ...]` when both are present.
  - `didYouMeanPlugin` skips `meta.hidden: true` siblings in both the
    Levenshtein suggestion corpus (canonical names **and** aliases) and
    the "Available commands" fallback list.
  - `@crustjs/man` filters `meta.hidden: true` subcommands from the
    SUBCOMMANDS section (and skips the section entirely when every
    subcommand is hidden), surfaces flag and arg `choices` as a
    `[choices: ...]` suffix, and includes long flag aliases in OPTIONS
    labels (`-o, --output, --out`, plus `--no-` negation for every long
    spelling on boolean flags).
  - `completionPlugin` bash and fish templates now track positional slot
    index past the resolved command path and emit per-slot choice
    candidates. Variadic-with-choices arguments are handled correctly
    (the choice list applies at every slot from the variadic's declared
    index onwards). The fish template gains a second per-script helper
    `__<ident>_path_at_arg` that the existing `__<ident>_path_is` is
    layered alongside; subcommand and flag rules continue to use the
    original predicate.

  Core / docs:

  - `CommandMeta.hidden` JSDoc now enumerates every tooling surface the
    flag affects (help, completion, did-you-mean, man, skills) and is
    explicit that there is intentionally no analogous `FlagDef.hidden` —
    the workaround for flag-level hiding is to register without a
    description.

### Patch Changes

- f1baa45: `helpPlugin` and `didYouMeanPlugin` are alias-aware.

  `helpPlugin`'s `COMMANDS:` section now renders the canonical name with any aliases inline as `name (alias1, alias2)` — e.g. `issue (issues, i)`. Commands without aliases render unchanged. The canonical name is styled while the alias suffix is plain so the canonical spelling stands out at a glance; column alignment is preserved using the ANSI-aware `padEnd` from `@crustjs/style`.

  `didYouMeanPlugin` includes aliases in its candidate list when matching against an unknown command, but always reports the canonical name in the `Did you mean "X"?` message. So a typo of an alias (`issuess` for `issues`) suggests the canonical (`issue`), and a candidate that matches both an alias and its canonical is deduplicated to a single canonical suggestion.

  Both behaviors require `aliases` on `CommandMeta`, added in the same release of `@crustjs/core`.

- b87e0ee: `helpPlugin` now omits subcommands marked `meta.hidden: true`.

  `formatCommandsSection` filters out subcommands whose `meta.hidden === true`
  before rendering the `COMMANDS:` block. If every subcommand is hidden, the
  section is omitted entirely (no orphan `COMMANDS:` heading). Insertion
  order of the surviving entries is preserved, and alias rendering composes
  correctly — a visible subcommand with aliases still renders as
  `name (alias1, alias2)`.

  Hidden filtering affects help output only. Hidden subcommands remain
  directly invocable by name; routing in `@crustjs/core` does not consult
  `meta.hidden`. This is intentional and load-bearing for internal
  runtime commands like the future `__complete` entrypoint used by
  shell-completion plugins.

  Requires `hidden` on `CommandMeta`, added in the same release of
  `@crustjs/core`.

- 70320f2: Renamed `autoCompletePlugin` to `didYouMeanPlugin`. The old export remains as a deprecated alias and will be removed in 1.0.0. The plugin's behavior is unchanged — it provides "did you mean?" command suggestion via Levenshtein matching, NOT shell tab completion.
- Updated dependencies [075490b]
- Updated dependencies [b87e0ee]
- Updated dependencies [f1baa45]
- Updated dependencies [075490b]
- Updated dependencies [8779692]
- Updated dependencies [82f5ad6]
- Updated dependencies [9db2613]
  - @crustjs/style@0.2.0
  - @crustjs/core@0.0.17

## 0.0.22

### Patch Changes

- df08a3a: Add NO_COLOR-aligned runtime color control.

  `@crustjs/style` now disables colors, but not non-color modifiers, when `NO_COLOR` is set to a non-empty value or when output is non-interactive in auto mode. The default exports also support runtime color overrides via `setGlobalColorMode()` and `getGlobalColorMode()`.

  `@crustjs/plugins` now includes `noColorPlugin()`, which adds `--color` and `--no-color` to a Crust CLI and applies the override for the current run.

  **Breaking:** The capability resolver exports have been renamed for symmetry with the new `resolveModifierCapability`:

  - `resolveCapability` → `resolveColorCapability`
  - `resolveTrueColor` → `resolveTrueColorCapability`

- Updated dependencies [df08a3a]
- Updated dependencies [df08a3a]
- Updated dependencies [67a9f25]
  - @crustjs/style@0.1.0

## 0.0.21

### Patch Changes

- Updated dependencies [def425e]
  - @crustjs/core@0.0.16

## 0.0.20

### Patch Changes

- 285ac24: Add colorful styling and defaults to help output

  - Style help output with ANSI colors for usage, sections, and tokens using `@crustjs/style`
  - Show default values for flags in help text
  - Display boolean negation flags (--no-<name>) for boolean options
  - Improve visual hierarchy with color-coded sections (usage in green, commands/options in cyan, required args in yellow)

- Updated dependencies [9b57c50]
  - @crustjs/style@0.0.6

## 0.0.19

### Patch Changes

- 5e0afa4: Fix inherited flags not being applied to subcommand trees injected by plugins. The help flag (`-h`) now correctly inherits into plugin-added subcommands.
- Updated dependencies [5e0afa4]
  - @crustjs/core@0.0.15

## 0.0.18

### Patch Changes

- 983204f: Add install-scope inference (`installScope` option, `UpdateNotifierInstallScope` type) and scope-aware upgrade commands to `updateNotifierPlugin`. Export `UpdateNotifierPackageManager` and `UpdateNotifierInstallScope` from the package entrypoint. The `updateCommand` callback now receives a third `installScope` argument (breaking for existing callbacks). Update notice output moved from stdout (`console.log`) to stderr (`process.stderr.write`).

## 0.0.17

### Patch Changes

- Updated dependencies [f78b327]
  - @crustjs/core@0.0.14

## 0.0.16

### Patch Changes

- d7bb1aa: Refactor `updateNotifierPlugin` options: make `packageName` required, remove `enabled` option, and move `intervalMs` into a new `cache` config object (`{ adapter, intervalMs? }`) to better co-locate cache-related settings.
- Updated dependencies [944f852]
- Updated dependencies [6dea64c]
  - @crustjs/style@0.0.5
  - @crustjs/core@0.0.13

## 0.0.15

### Patch Changes

- Updated dependencies [b8ebfa4]
  - @crustjs/core@0.0.12

## 0.0.14

### Patch Changes

- 7dc9ede: Simplify `UpdateNotifierCacheAdapter` by removing the unused `packageName` parameter from `read()` and `write()`, allowing `@crustjs/store` instances to be passed directly as the `cache` option.
- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
  - @crustjs/core@0.0.11

## 0.0.13

### Patch Changes

- 1715c81: Style update notifier with a colored boxed notice using `@crustjs/style`

## 0.0.12

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10

## 0.0.11

### Patch Changes

- cae6ea2: Add `updateNotifierPlugin` to `@crustjs/plugins`. The plugin checks the npm registry for newer versions of your package and displays a non-blocking update notice after command execution. It is non-persistent by default, supports optional cache adapters (including `@crustjs/store`) for cross-run caching and dedupe, and uses package-manager-aware update commands with override support. Adopted in the `crust` CLI and the `create-crust` scaffold template by default.

## 0.0.10

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- Updated dependencies [a1f233e]
- Updated dependencies [e3624b2]
  - @crustjs/core@0.0.9

## 0.0.9

### Patch Changes

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8

## 0.0.8

### Patch Changes

- Updated dependencies [1364768]
  - @crustjs/core@0.0.7

## 0.0.7

### Patch Changes

- fe4d64d: Make `path` parameter optional in `renderHelp`, defaulting to `[command.meta.name]` for simpler usage

## 0.0.6

### Patch Changes

- Updated dependencies [8c23587]
  - @crustjs/core@0.0.6

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish
- Updated dependencies [8e0b48a]
  - @crustjs/core@0.0.5

## 0.0.4

### Patch Changes

- dcc258c: switch to use literal string for flags and args types
- Updated dependencies [115d396]
- Updated dependencies [9b951e9]
- Updated dependencies [bdd101f]
- Updated dependencies [dcc258c]
  - @crustjs/core@0.0.4

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
- Updated dependencies
  - @crustjs/core@0.0.3
