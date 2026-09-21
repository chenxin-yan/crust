# Crust optimization roadmap

Investigation at `b79c147ad81549d5cf8755993bf707b539fda996`, 2026-09-20. Four parallel source audits were followed by isolated serial experiments and an independent reviewer, then a strengthened test, a longer-warmup follow-up and a build-configuration experiment.

**Status:** backlog items 1–4 are the stacked PRs #415 → #416 → #417 → #418; item 5 (root-snapshot subtree walk, variant A of the lever-1 experiment) is #421 on top. Measured on the 5-PR tip with the same harness ([after-stack5.md](../cli-comparison/results/after-stack5.md) vs [full.md](../cli-comparison/results/full.md); 4-PR tip in [after-stack.md](../cli-comparison/results/after-stack.md)): Crust fresh-schema warm invocation 58.36 → 45.99 µs on Bun (−21%) and 65.56 → 50.07 µs on Node (−24%); startup and bundle size within noise; competitor controls drifted +1–9% slower in that session, so the Crust delta is not session drift. The cached-at-prepare (B) and lazy-snapshot (C) variants were measured and parked behind a contract decision; see the #421 discussion. Items 6+ remain open.

## Recommendation

1. Adopt the **no-sections snapshot guard** and **shallow spelling-entry sharing** as separate, tested changes, then measure them together. Neither requires a new public API or parser.
2. Next investigate **copying builder fields only when needed** and **skipping discarded short-option descriptors**. Their wasted work is source-proven; their speed benefit is not measured.
3. Treat the **supported production build configuration** as a separate size axis. Its internal define reduced this fixture by **596 gzip bytes** without changing Core. Recommend the supported `crust build` route, not manually setting its reserved marker.
4. Preserve immutable builders, live defaults, validation, diagnostics, Context lifecycle and extension behavior. Do not pursue a reduced-feature dispatcher merely to win this fixture.

**These initial changes do not establish that Crust is now the fastest framework.** The original fresh-schema median is roughly four times Commander's; the isolated improvements below do not close that gap, were not measured together, and must not be added. Crust already has the smallest _uncompressed minified_ bundle among the full frameworks in the [original comparison](../cli-comparison/results/full.md); improving compressed size and construction/invocation cost are separate goals.

## Evidence and measurement boundaries

- [Frozen comparison and methodology](../cli-comparison/README.md): 11 libraries plus builtin baseline, Bun 1.4.2 / Node 26.8.2, Ryzen 7 6800H. Its files and fingerprint remain unchanged.
- [Retained evidence](./evidence/experiment.json): raw samples, warmup traces, worker-level summaries, mechanism counters, conformance, test logs, source/bundle hashes and replay-script contents. `records` keys retain the original artifact filenames.
- [Sections prototype](./evidence/sections.patch), [spelling-map prototype](./evidence/spellings.patch), [deferred schema prototype](./evidence/schemas.patch): **unapplied experimental patches**, not merge-ready patches.
- Complete source copies, built probes and CPU/heap profiles lived in a temporary scratch directory (path recorded in `experiment.json`); it may be gone. The essential evidence above is retained here. Raw profiles are not embedded in the JSON.
- Workflow `c6f02e47-1bc1-43f9-9449-4da83397854a` contains the four audit reports, experimental handoff and independent review. This document consolidates their recommendations rather than adopting every proposed optimization.

The original fixture builds a new application each call and includes common argv copying, `await`, JSON serialization and result validation. It is **not pure tokenizer speed**. Source-copy experiments use an identically built unmodified source-copy control; they are not compared directly with the tsdown-built original as if that build-input difference were a gain. Only the separate define experiment reproduces the original bundle hash exactly.

No statistical-significance claim, controlled CPU governor, filesystem-cold startup, or comprehensive workload coverage is implied.

## Verified candidates

### Initial paired experiment

Five workers per variant/runtime; three warmup batches and five recorded batches of 300 calls each. Values are medians across batch-average times. Full spreads are retained in the evidence.

| Independent variant            | Bun µs/call | Node µs/call | Minified B | Gzip-9 B | Mechanism confirmed                                                         |
| ------------------------------ | ----------: | -----------: | ---------: | -------: | --------------------------------------------------------------------------- |
| Unmodified source-copy control |       58.32 |        64.23 |     34,155 |   11,719 | 13 node clones, 7 node projections, 30 spelling-entry copies, 2 schema Maps |
| No-sections snapshot guard     |       54.26 |        59.05 |     34,192 |   11,729 | Node projections 7 → 4; flag projections 14 → 9                             |
| Shallow spelling-Map clone     |       50.47 |        63.02 |     34,087 |   11,697 | Spelling-entry copies 30 → 0; Map containers remain independent             |
| No-schema copy shortcut        |       55.92 |        65.98 |     34,364 |   11,752 | Schema Maps 2 → 0, but added scans and code                                 |

**Decision:** advance the first two; defer the no-schema shortcut. Fewer allocations alone do not justify a slower/more complicated path. The no-schema experiment increased Node's median and size; mixed-schema performance was not measured.

### Longer-warmup follow-up

The independent reviewer noticed a repeatable slow batch early in each Node worker. The parent therefore reran control/sections/spellings with **20 warmup + 20 recorded batches × 300 calls, four fresh workers**, serially with equal forward/reverse ordering. All warmup and measurement batches are retained in `warm-long.json`; none were selectively discarded. This is a supplemental session, not a replacement for the historical ranking.

| Variant        | Bun median of worker medians, µs | Bun worker medians, µs     | Node median of worker medians, µs | Node worker medians, µs    |
| -------------- | -------------------------------: | -------------------------- | --------------------------------: | -------------------------- |
| Control        |                            50.98 | 50.71, 51.78, 47.89, 51.25 |                             52.97 | 52.67, 52.32, 53.27, 56.22 |
| Sections guard |                            47.27 | 48.37, 52.80, 46.16, 44.24 |                             44.72 | 44.28, 43.97, 45.17, 46.86 |
| Spelling clone |                            43.80 | 46.88, 44.04, 42.41, 43.56 |                             51.30 | 50.38, 51.15, 51.78, 51.45 |

The sections guard was faster in all four Node pairs and three of four Bun pairs. The spelling clone was faster in all four pairs on each runtime, with a smaller Node difference. **Directional confidence improved, but stable steady-state performance is still not established:** first versus last recorded batches continue to drift and Node retains long tails. Use longer traces, multiple independent sessions and paired worker summaries before publishing a fixed percentage claim. Competitors were not rerun with this warmup protocol, so these numbers cannot be substituted into the ranking table.

### Existing supported build configuration: separate from Core changes

The parent rebuilt the **same frozen entry** with identical settings, changing only the internal define supplied by the official build implementation. The unmarked control exactly reproduced original SHA-256 `df3ccef7cd95944be1033b5e9e3ba7847d8a755b5bfc0a6d6ab7e5b99944ebf2`.

| Configuration              | Minified B | Gzip-9 B |
| -------------------------- | ---------: | -------: |
| Uniform no-define baseline |     34,243 |   11,735 |
| Official build define      |     32,713 |   11,139 |
| Reduction                  |      1,530 |      596 |

Both passed the original valid/repeated/default-reset and invalid-input checks on Bun and Node; rejection status/stdout/stderr matched. This is **a direct paired define experiment, not an actual `crust build` artifact test**. It does not verify artifact paths, build hooks, Bun compilation or Deno distribution behavior, and no startup improvement was measured. The marker is reserved and affects artifact resolution too; its [owning build code](../../packages/crust/src/utils/build-helpers.ts) supplies it. Do not silently add it to the uniform cross-library benchmark or claim that a one-byte difference versus another library establishes a winner.

## Consolidated implementation backlog

Evidence labels: **tested** = disposable variant plus semantic checks; **source-proven** = unwanted work exists, speed benefit not measured; **conditional** = semantic/API decision or stronger evidence required. Priority is adoption order, not a universal severity scale.

| Order | Recommendation                                                          | Evidence / target                                                                     | Smallest change and owner                                                                                                                                                                                      | Required checks / risks                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Skip authored snapshot when no extension has sections                   | **Tested**; fresh preparation, not already-prepared execution                         | Guard projection + section loop in `command/invocation.ts:128–137`; always retain `freezeTree`                                                                                                                 | All callbacks must receive one shared pre-contribution snapshot; derived builders and build-hook refresh still work. Removing unused projections also removes observable URL-subclass getter reads; qualify that edge case.                                       |
| 2     | Clone spelling Map containers, share entries                            | **Tested**; construction/preparation allocations and small size cleanup               | `new Map(node.flagSpellings)` in `command/extensions-install.ts:59–86`                                                                                                                                         | Entries must remain immutable-by-convention; add readonly fields/invariant documentation. Keep distinct containers and definition identity. Check retained builders, canonical/short/long aliases, alias negation, replacement/provider flags.                    |
| 3     | Avoid cloning fields immediately overwritten                            | **Source-proven**; constructor/fluent-chain and extension-heavy cost                  | `_clone` in `command/crust.ts:1258–1275`; copy only non-overridden structural containers, or begin with `.extend`'s already-owned full-node handoff                                                            | Inspect all `_clone` callers together. Preserve prototype, lineage, descendant sharing, atomic failure, retained-builder cache isolation and type inference. Do not introduce a second builder model.                                                             |
| 4     | Skip descriptors for short-only spelling entries                        | **Source-proven**; small per-parse allocation cleanup                                 | Early-continue before descriptor construction in `parsing/parser.ts:51–68`; canonical descriptor already carries the short name                                                                                | Verify identical builtin options, aliases, one-character long aliases, short clusters and inline values on both runtimes. JIT may already remove discarded allocation; measure rather than assume a win.                                                          |
| 5     | Reuse selected subtree within an invocation's root snapshot             | **Conditional**; both fresh and reused dispatch, promising profile location           | Navigate the already-projected root using canonical `route.commandPath`, instead of a second selected-subtree projection at `command/invocation.ts:225–229`; similarly inspect duplicate synthetic-error roots | Changes cross-field object identity and projection/getter counts. Make that contract decision explicitly. Keep per-invocation live default projection; no global final-snapshot cache. Test nested/alias selection, hidden children, action/hook/error snapshots. |
| 6     | Skip provider reconstruction for providerless extension changes         | **Source-proven**; help/version-style extension authoring, not extension-free fixture | Fast path at `installExtensionContexts` only if **old and new active extension sets** contain no providers                                                                                                     | An old provider replaced by a providerless extension must still be removed. Test last-registration ordering, descendant-local shadowing, provider flags and old/new/base isolation.                                                                               |
| 7     | Route using an argv cursor                                              | **Source-proven**; long flag prefixes/deep command trees                              | Replace repeated suffix slices in `command/router.ts:128–231` with one cursor and final result construction                                                                                                    | Keep every descendant forwardability check, flag values equal to command names, alias paths, terminators, unknown-flag behavior and untouched caller input. Removing slices does not make every part of routing linear.                                           |
| 8     | Combine positional classification and canonical flag-token collection   | **Source-proven**; larger argv                                                        | Merge two post-tokenization walks in `parsing/parser.ts:197–222,397–414`                                                                                                                                       | Preserve interleaved alias occurrence order, scalar last-token-wins, raw `--` positionals, excess-argument diagnostics and definition-order transforms. Extra branching may erase tiny-input gains.                                                               |
| 9     | Query home directory only for tilde-expanding paths                     | **Source-proven**; path workloads, no direct deploy-fixture benefit                   | Conditional existing replacement in `parsing/coercers.ts:45`; leave live cwd/home semantics                                                                                                                    | Cover `~`, `~/x`, `~user`, absolute/relative/default/structured paths and changed environment. Do not cache resolved paths or replace string-replacement semantics accidentally.                                                                                  |
| 10    | Decouple tooling protocol constants from runtime implementation imports | **Source-proven graph coupling**, size saving unknown                                 | Leaf owner for `SNAPSHOT_PATH_ENV`, preserving existing re-exports in `tooling.ts` and imports in invocation/build helpers                                                                                     | Measure existing docs-only and CLI size fixtures first. Tree shaking may already remove the dependency. Consider the artifact env constant only if first measurements justify it; do not remove `resolveArtifactDir`.                                             |

All source paths in this table are under [`packages/core/src`](../../packages/core/src/) unless otherwise stated. Exact proposed sections/spelling/schema edits are retained as patches; other entries are investigation tasks, not implemented optimizations.

### Things not to adopt now

- **The tested no-schema branch:** more bytes, uncertain Bun benefit and no demonstrated Node gain. A future simpler representation change needs its own no-schema and mixed/async-schema experiment.
- **Permanent final-snapshot caching:** defaults may contain mutable URL/JSON/schema payloads; a later snapshot must observe a changed URL. Frozen node structure is not deep immutable user data. Prefer removing duplicate work within an invocation.
- **Caching Contexts, parsed values, transformed defaults or environment results:** these are invocation-owned; would risk concurrency, stale state, callback counts, cleanup and error behavior.
- **Mutable public builders or skipped validation/diagnostics:** existing callers and tests rely on those contracts. `.command()` sugar and `contextSources` have actual type/Effect consumers; they are not dead layers to delete.
- **A custom tokenizer or using `parsed.values` instead of tokens:** no evidence justifies a replacement. Token reconstruction preserves interleaved alias order. Installed Node builds tokens internally even when `tokens:false`; disabling exposure is not established as a speedup, and Bun must be evaluated separately.
- **Blind Promise/await flattening or removing disposal fallback:** preserve finish, async action/schema behavior, error precedence, pending Context settlement and Node 22 compatibility. Profile first; `return await` may be essential inside resource scopes.
- **Hook-function caching:** nested hook objects are not necessarily immutable; currently hook properties are read at invocation time.
- **Parse-plan caching, alias indexes, helper-normalization shortcuts, extension-deduplication rewrite:** investigate only with reused/large-tree/extension-heavy evidence. Existing prepared-tree cache already works; fresh-builder measurements cannot establish the benefit of retained plans. Definition ownership and destination collisions are separate checks, not duplicate validations to delete blindly.

## Tree-shaking experiment (closed)

Question: can the generic bundle get smaller by making unused subsystems unreachable? Method: isolated source copies on the 5-PR tip, paired builds, conformance on Bun and Node, sizes and timings on two fixtures — F1 (the plain 2-command CLI) and F2 (the same CLI actively using one `defineContext` and one `defineExtension`). Evidence: [`evidence/tree-shaking-sizes.json`](./evidence/tree-shaking-sizes.json), [`evidence/tree-shaking-startup.json`](./evidence/tree-shaking-startup.json), [`evidence/tree-shaking-await-boundary.json`](./evidence/tree-shaking-await-boundary.json).

| Variant                                                                                                                |     F1 gzip-9 B |     F2 gzip-9 B | F1 fresh-schema µs Bun / Node | F2 fresh-schema µs Bun / Node | Decision                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | --------------: | --------------: | ----------------------------: | ----------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| control (5-PR tip)                                                                                                     |          11,731 |          12,263 |                 41.40 / 45.70 |                 62.35 / 64.85 | —                                                                                                                                                                                                                                         |
| A: runtime capabilities attached to `defineContext`/`defineExtension` so unused resolver/installer code is unreachable |      **10,050** |          12,541 |                 37.27 / 41.53 |                 66.51 / 66.28 | **Rejected.** Real shake (−14% F1), but apps that use contexts/extensions — the common case, `help` is an extension — pay +2% bytes and +2–7% time.                                                                                       |
| B1/B2: dynamic-import the structured parser and the terminal/fs/os builtins                                            | 11,842 / 11,847 | 12,388 / 12,392 |                     ≈ control |                     ≈ control | **Rejected.** Single-file bundlers inline dynamic imports, so bytes go _up_; the added `await` boundaries are observable (a caller mutating state right after `run()` sees a different action result).                                    |
| control built with the supported `crust build` define                                                                  |      **11,080** |               — |                     ≈ control |                             — | **Already shipping.** −5.5% bytes and −4.5 ms Node startup (eager `node:fs/promises` gone: 41.75 → 37.16 ms); every `create-crust` template's `build` script is `crust build`, which applies the define unconditionally for Bun and Node. |

Conclusion: within the fluent-class API the reachable set is the reachable set; the only free size/startup win is the production build path that already exists. Users who bundle `@crustjs/core` with their own bundler forgo it; making the marker public would be a product decision, not an optimization. Do not re-explore lazy imports or definition-carried runtimes without a new constraint.

## What the profiles establish

Node fresh diagnostic self-samples prominently included `freezeCompact`, GC, `cloneCommandNode` and `snapshotCommand`; reused execution still included projection/freezing work. Bun attributed more samples to native freezing, object cloning and `parseArgs`. This supports investigating snapshots and cloning, **not removing a claimed percentage of runtime**.

Profiled runs were observably slower than matched unprofiled diagnostic runs, especially on Bun. Samples include imports/preflight/warmup as well as measured loops. Heap sampling does not measure total transient allocation bytes per operation. Allocation-removal claims above come from separate untimed mechanism counters, not heap-profile file size.

A public-API lifetime diagnostic already demonstrates the value of keeping an app:

| Diagnostic all-flags median, µs           |   Bun |  Node |
| ----------------------------------------- | ----: | ----: |
| Fresh factory + execute                   | 50.86 | 51.06 |
| First execute, construction outside timer | 37.78 | 45.22 |
| Reused execute                            | 19.22 | 25.88 |

These are identically built **unminified diagnostic bundles**, not the league-table fixture. Reuse resets its result sink and validates alternating inputs/defaults. The categories cannot be subtracted as a causal phase decomposition or compared with historical competitor medians. Any cross-library reuse ranking must validate supported reuse for every comparator, not just Crust.

## Safety and verification status

### Completed in isolated copies

- Original/control/three candidates: frozen positive/reset and 20 negative cases on Bun 1.4.2 and Node 26.8.2; error status and complete stdout/stderr matched within runtime.
- Control and each candidate: **546 Core source tests passed, 0 failed, 1,330 assertions**, plus Core compile-only types. Logs retained. These are child-run checks inspected by parent, not a claim that the whole monorepo suite ran.
- Targeted checks on both runtimes/every copy: builder isolation, live environment/custom parsers, mutable URL snapshot defaults, shared authored sections, raw hook/action isolation and schema-copy edge cases.
- Reviewer finding fixed by parent: canonical/short/long alias and both canonical/alias negation now assert bound values, not just exit status. A deliberately wrong action result (`enabled:true`) fails the strengthened assertion on **both** runtimes despite successful parsing. Eight strengthened variant/runtime checks passed.
- Parent: longer-warmup serial experiment, exact-control-hash paired build-define conformance, and final original-benchmark fingerprint verification.

### Required before production adoption

1. Promote meaningful semantic checks to existing co-located tests; do not add fragile timing thresholds. In particular preserve alias bindings/container isolation and sections refresh/input ordering.
2. Apply candidates separately, run relevant source tests and Core types, then actual package build/integration/declaration tests when affected. Check repository lint/format and update relevant comments/docs. Use a changeset for user-visible performance changes; do not hand-edit changelogs.
3. Add a **built-package Context lifecycle smoke** before touching resolver/disposal/async setup. Existing runtime smoke covers async actions but not Context pull/setup/disposal. Verify concurrent invocations, shared pulls within one invocation, LIFO cleanup after post-hooks, pending siblings and original-error precedence.
4. Exercise the existing minimum-runtime matrix: **Node 22, Bun 1.4.0 and Deno 2.8**. This investigation used Node 26/Bun 1.4.2, not those floor versions. No floor-runtime or Deno result is claimed.
5. Verify actual `crust build` Node/Bun outputs, sections after build hooks, artifact paths and source snapshot protocol before a production-build recommendation is treated as fully tested.
6. Measure combined accepted changes against an identical control. Repeat independent sessions with warmup traces and worker-level pairs. Re-run the original same-lifecycle cross-library comparison under identical rules only after changes pass conformance; never overwrite its historical snapshot.

### Supplemental workload priorities

Retain the tiny CLI, then add only workloads that answer remaining questions: wide/deep trees and long argv; many aliases; extensions with/without providers/sections; no-schema and async-schema paths; lazy Context setup/disposal; finish/error/cancellation; and separately labeled captured `run()`/bound handles. Keep startup, fresh schema, reused invocation, gzip/minified size and TypeScript/declaration cost separate. The fastest bare parser is not a feature-equivalent target for the complete framework.

## Suggested delivery sequence

- **PR 1:** sections guard plus regression coverage and measured before/after.
- **PR 2:** spelling-entry sharing, explicit invariant, and bound-value/container-isolation tests. Measure alone and with PR 1.
- **Next experiment:** override-aware cloning and skipped short descriptors, independently. Advance snapshot-subtree reuse only after its identity contract is settled.
- **Distribution follow-up:** test actual supported build artifacts; keep generic bundle and configured-build results separate. Measure leaf-constant cleanup before changing imports.
- **Later only if measurements justify it:** long-argv routing/token work, providerless extension fast paths and retained parse plans. No broad rewrite, new compiler layer, parser replacement or public API churn is justified by current evidence.

The investigation identifies actionable work and rejects unsafe shortcuts; it does not claim exhaustive verification of every hypothetical optimization or that any prototype is ready to merge without the adoption gates above.
