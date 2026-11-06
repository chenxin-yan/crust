# @crustjs/effect

## 0.2.4

### Patch Changes

- [#539](https://github.com/chenxin-yan/crust/pull/539) [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove the `engines.deno` declaration; Deno is no longer supported.

- [#522](https://github.com/chenxin-yan/crust/pull/522) [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - A Standard Schema without the optional `types` member now infers its output from the successful `validate()` result (awaited) instead of `unknown` in store fields, env variables, and schema-backed flags and arguments; declared `types.output` still wins. `defineEnv()` now rejects a literal default outside literal `choices` and an async `parse` at compile time, as `defineFlag()` does. A store schema whose output is not JSON data now fails with a `FIX_JSON_OUTPUT` message instead of "not assignable to type 'never'". `@crustjs/effect` exports the `HandlerInput` type that `service()` requires, and `@crustjs/core/tooling` exports `LocalValueBrand`.
- Updated dependencies [[`6a7e073`](https://github.com/chenxin-yan/crust/commit/6a7e073c4cb59452a03f41cbe656fd03e2b56dc9), [`a805be3`](https://github.com/chenxin-yan/crust/commit/a805be3923e60e64e34fb3ac49a41b9f4b7cf71a), [`fd54147`](https://github.com/chenxin-yan/crust/commit/fd541473c362c3f0c1054513ca00bbd681287d78), [`3c78cc9`](https://github.com/chenxin-yan/crust/commit/3c78cc9cc461be383551f599e838cb1e7253a4a1), [`4f4d9e9`](https://github.com/chenxin-yan/crust/commit/4f4d9e9eb44a7f43577bfd883ae7959dd112ac64), [`8bf19e2`](https://github.com/chenxin-yan/crust/commit/8bf19e2627ccf49a74792ae84d363718ebc04b9f), [`cc3048c`](https://github.com/chenxin-yan/crust/commit/cc3048cb281e4f6cf556e81ed7358d7e2fb0e52c), [`484e055`](https://github.com/chenxin-yan/crust/commit/484e0552aeadbaa4103bc61553f1183ee25b212c), [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7), [`6e4e59b`](https://github.com/chenxin-yan/crust/commit/6e4e59bfa71d72daf39ceebc752e27d29b0449af), [`014d5aa`](https://github.com/chenxin-yan/crust/commit/014d5aa41499d1a0cc69f83589a0ff7a0f0432c7), [`46ab354`](https://github.com/chenxin-yan/crust/commit/46ab3549974b98b36329471cf212e3171e8fdf5e), [`da6dace`](https://github.com/chenxin-yan/crust/commit/da6dacef13b95abcbe5472ebaf1de441cddb0003), [`0a2c6b1`](https://github.com/chenxin-yan/crust/commit/0a2c6b198b07b693789f10a4c0532f27b94a6a9d), [`8544498`](https://github.com/chenxin-yan/crust/commit/854449869f795f00505952dc04d653f2e7f6f923), [`d5a9522`](https://github.com/chenxin-yan/crust/commit/d5a9522f11836b7c6beac79901f87f6d74d608a2), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`7e2da48`](https://github.com/chenxin-yan/crust/commit/7e2da482af5a21d27a2d32839a051cc6e0c36974), [`e974d05`](https://github.com/chenxin-yan/crust/commit/e974d05834785604ed16551613baec9e7a961c4a), [`9592652`](https://github.com/chenxin-yan/crust/commit/95926524d877ebc6d20307095408bac2f5fa95d4), [`0ab1ca1`](https://github.com/chenxin-yan/crust/commit/0ab1ca1e69caa38a872a2cf36266b200664d5228), [`8ff9c6a`](https://github.com/chenxin-yan/crust/commit/8ff9c6abeaf3b89adb90f72c533d98d5c13ccce9), [`48823e8`](https://github.com/chenxin-yan/crust/commit/48823e82c50f583b990b99f49f5441bcf0280723), [`09a6808`](https://github.com/chenxin-yan/crust/commit/09a68080e8809b507dbcd0c581bd9942b186f44b), [`02993c7`](https://github.com/chenxin-yan/crust/commit/02993c71a43cafa1cbbd9853bf00e991efccb1cb), [`3273ceb`](https://github.com/chenxin-yan/crust/commit/3273ceb045554c446ac7da4937885700bf349d17), [`97e8def`](https://github.com/chenxin-yan/crust/commit/97e8def311a44507f4c06f16843f840bfa587d12), [`d863ca6`](https://github.com/chenxin-yan/crust/commit/d863ca674800fe6a1595187378129c2bef86a9f6), [`75555f3`](https://github.com/chenxin-yan/crust/commit/75555f37d8624114c02cf8af3cace0e6826aef02), [`34df0c6`](https://github.com/chenxin-yan/crust/commit/34df0c604910ceab083a7e88910cc510da4a5c5a), [`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`27f5832`](https://github.com/chenxin-yan/crust/commit/27f583260be2ad90544dd85d5653f7ab23255cff), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d), [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073), [`3f0db61`](https://github.com/chenxin-yan/crust/commit/3f0db6189a1e33d3c5e9dbee44624feadc8a7cb0), [`aad9c15`](https://github.com/chenxin-yan/crust/commit/aad9c156dd89b3283e73cb420aac724d2f3598eb), [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761), [`4e2c3d7`](https://github.com/chenxin-yan/crust/commit/4e2c3d73577561d447e0ef58f7fc521b8a6fa3fa), [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d), [`0cf0914`](https://github.com/chenxin-yan/crust/commit/0cf091408ad9e1251b6e8f42712b20299e591309), [`71cd6dd`](https://github.com/chenxin-yan/crust/commit/71cd6dd8b0e5af788e11ccd68616b3c7b1c693ba), [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19)]:
  - @crustjs/core@0.6.0

## 0.2.3

### Patch Changes

- [#484](https://github.com/chenxin-yan/crust/pull/484) [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update the package description shown on npm and in the README.

## 0.2.2

### Patch Changes

- [#480](https://github.com/chenxin-yan/crust/pull/480) [`1463c45`](https://github.com/chenxin-yan/crust/commit/1463c458fa1f48e8ab3769de5b3ab58f9b18b04d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Support the stable Effect v4 release. The `effect` peer dependency is now `^4.0.0`, so installs of `4.0.0-rc.*` prereleases are no longer in range. Upgrade with `bun add effect@4`.

## 0.2.1

### Patch Changes

- [`3b9245a`](https://github.com/chenxin-yan/crust/commit/3b9245a765fd48ef0625c22d1991b7cd6a91dc45) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update MCP SDK and the supported Effect RC and OpenTUI dependency versions.

- [#469](https://github.com/chenxin-yan/crust/pull/469) [`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the minimum supported Node.js version to 24. Remove the Node 22 disposal-stack fallback and use native AsyncDisposableStack on all supported runtimes. Update generated Node projects to require Node 24 and use @types/node 24.

## 0.2.0

### Minor Changes

- [#454](https://github.com/chenxin-yan/crust/pull/454) [`0b835c2`](https://github.com/chenxin-yan/crust/commit/0b835c20b9bcf09e9dea7f179eeecd43a9c50763) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add typed environment Contexts with redacted validation errors and command-scoped help/man sections. Reuse the core flag value pipeline and preserve ENV errors in the Effect adapter.

### Patch Changes

- [#462](https://github.com/chenxin-yan/crust/pull/462) [`fe08f18`](https://github.com/chenxin-yan/crust/commit/fe08f1887a7b36e68741102c0c7d0586b5a12a35) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Skip Layers shadowed by a same-name descendant Context in handler(), so a descendant plain Context stays lazy and no longer fails the action
- Updated dependencies [[`bc3cbb2`](https://github.com/chenxin-yan/crust/commit/bc3cbb250974fcdba4ce2f50ee4b6b90a1f16c30), [`c4f44d6`](https://github.com/chenxin-yan/crust/commit/c4f44d6f9e3dd206154d0b18a84fb75464dc2dfe), [`0b835c2`](https://github.com/chenxin-yan/crust/commit/0b835c20b9bcf09e9dea7f179eeecd43a9c50763), [`eb9928d`](https://github.com/chenxin-yan/crust/commit/eb9928d60edc3033652ad55a3a019e790dafdf06), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93)]:
  - @crustjs/core@0.5.0

## 0.1.3

### Patch Changes

- [#445](https://github.com/chenxin-yan/crust/pull/445) [`2482d70`](https://github.com/chenxin-yan/crust/commit/2482d70fb50981bafad1283992fbf1fc16953312) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Publish @crustjs/effect under the default latest npm dist-tag instead of next, and update installation instructions.

## 0.1.2

### Patch Changes

- Updated dependencies [[`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb), [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb)]:
  - @crustjs/core@0.4.0

## 0.1.1

### Patch Changes

- [#424](https://github.com/chenxin-yan/crust/pull/424) [`52e0938`](https://github.com/chenxin-yan/crust/commit/52e0938ceee270340c366afb59f756d455d1623a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `handler()` and `layer()` run the Effect program and Layer builds with the invocation's `ctx.signal`. Caller cancellation or Ctrl-C during `execute()` interrupts the fibers, including interruptible Layer acquisition, and hands Layer finalizers the interruption Exit. Signal interruption becomes an `AbortError` and exits 130 even when the caller supplies a custom abort reason. Cleanup runs without the aborted signal so finalizers can finish.

## 0.1.0

### Minor Changes

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: service(factory) now requires the provided Context to come from that same factory, including its .of() doubles. Different same-name factories fail through CrustDefinitionError rather than returning a value with an unchecked type. Add a typechecked Effect documentation example.

### Patch Changes

- [#377](https://github.com/chenxin-yan/crust/pull/377) [`c15d855`](https://github.com/chenxin-yan/crust/commit/c15d855b43d55605a310719c63f50d89c23a416d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `@crustjs/effect`, an Effect.ts v4 adaptor for Crust.
  
  - `layer(name, layer)` turns one fully composed Layer into an ordinary Crust Context. The Layer is built in a fresh Scope and closed by Crust's reverse-order invocation cleanup, handing finalizers the handler's `Exit`.
  - `handler(fn)` adapts an Effect-returning function or a generator (`function*`) to a Command Action. Every `layer()` on the command path is built up front and its services provided, with requirements checked at compile time; failures rethrow the original error so `execute()` rendering is unchanged, and interruption maps to Crust's `AbortError` cancellation path.
  - `service(factory)` pulls a plain Crust Context lazily from inside a handler program.
  - Tagged errors `CrustDefinitionError`, `CrustValidationError`, `CrustParseError`, and `CrustCommandNotFoundError` wrap the Core error codes for `Effect.catchTag`, plus `fromCrustError` and `tryCrust`. Prompt cancellation (`AbortError`) becomes Effect interruption.
  
  `effect` 4.x prerelease is a peer dependency; the package publishes under the `next` dist-tag.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Match service() against the effective last same-name Context provider, rejecting shadowed factories while preserving same-factory doubles.
- Updated dependencies [[`c15d855`](https://github.com/chenxin-yan/crust/commit/c15d855b43d55605a310719c63f50d89c23a416d), [`955f85c`](https://github.com/chenxin-yan/crust/commit/955f85c130400c7c8d0e63efa9b16807482dba3e), [`e450975`](https://github.com/chenxin-yan/crust/commit/e450975f70d9dffda5fe068b55d56c48eb17ab44), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`33cd937`](https://github.com/chenxin-yan/crust/commit/33cd93792366803f2b33fac16fc4ab99057f9b0b), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`19c99e7`](https://github.com/chenxin-yan/crust/commit/19c99e77ffcff792527064354b2c5b9d756c51df), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73), [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3), [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3), [`1a919d7`](https://github.com/chenxin-yan/crust/commit/1a919d773f592cab65afd8d8f437c7947016523d)]:
  - @crustjs/core@0.3.0
