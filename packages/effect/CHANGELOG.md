# @crustjs/effect

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
