# `@crustjs/tui` is Bun-only and renderer-agnostic

Status: accepted

## Context

Every published Crust package declares Bun 1.3.14+, Node.js 22+, and Deno 2.8+, and CI smokes the built
distributions on all three. `@crustjs/tui` wraps OpenTUI (`@opentui/core`), which loads a native Zig library
over FFI: it supports Bun 1.3+ and Node.js 26.4+ (`--experimental-ffi`) only, with no Deno support.
OpenTUI is also pre-1.0 (0.5.x) with a fast release cadence.

## Decision

- `@crustjs/tui` declares `engines.bun` only and is documented as the one Bun-only Crust package. It is not
  added to `scripts/smoke-runtimes` and `runtimes.mdx` carves it out explicitly. The portable-runtime CI guard
  is unchanged: the package itself uses no `Bun.` APIs; OpenTUI does the Bun-specific work.
- `@opentui/core` is a caret-ranged `peerDependency`, not a dependency: the app must install it anyway to
  write components, and two copies would break the reconciler.
- The package exposes one framework-agnostic entry, `runTui(mount, config?)`, and owns only the renderer
  lifecycle (TTY gate, `createCliRenderer`, resolve on destroy, Ctrl+C → `AbortError`). It ships no
  `/react` or `/solid` subpaths: both OpenTUI renderers accept a pre-made `CliRenderer` and unmount
  themselves on its `destroy` event, so a subpath would save one consumer line at the cost of four peer
  dependencies (including an exact-pinned `solid-js`).

## Considered options

- Ink instead of OpenTUI: Node-portable, but React-only and no Solid or imperative path.
- Node 26.4+ in `engines` alongside Bun: rejected until OpenTUI's Node path stabilizes past the experimental flag.
- Separate repo outside the runtime matrix: rejected; the package is small and benefits from the shared toolchain.

## Consequences

- The first Crust package whose runtime claim differs from the rest; docs must say so wherever the matrix is stated.
- OpenTUI minor bumps require a deliberate peer-range bump and changeset.
