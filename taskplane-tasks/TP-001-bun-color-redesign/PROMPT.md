# Task: TP-001 — Redesign `@crustjs/style` dynamic colors around `Bun.color`

**Created:** 2026-04-29
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Public API change in a semi-public package — old hex/rgb-specific
exports are removed and replaced with a single `fg` / `bg` pair driven by
`Bun.color`. Plan review is needed up front to lock the API shape and error
contract; code review is needed at the end to validate escape parity and that
nothing in the rest of the monorepo regressed.
**Score:** 5/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-001-bun-color-redesign/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Resolve [issue #106](https://github.com/chenxin-yan/crust/issues/106) by replacing
the hand-rolled hex / rgb parsing in `packages/style/src/dynamicColors.ts` with
a single canonical color API powered by Bun's built-in
[`Bun.color()`](https://bun.com/docs/runtime/color). The current API requires
users to pick the right of four similar functions (`rgb`, `bgRgb`, `hex`,
`bgHex`) based on input format, and only supports `#RGB` / `#RRGGBB` and
positional `(r, g, b)` ints. After this task, consumers call **one** `fg` /
`bg` pair that accepts any input `Bun.color()` understands — hex (3/6/8 digit),
named CSS colors (`"red"`, `"rebeccapurple"`), `rgb()` / `rgba()` strings,
`hsl()` / `hsla()` strings, `lab()` strings, numeric (`0xff0000`), `{r, g, b}`
objects, and `[r, g, b]` arrays. The redesign keeps zero runtime dependencies,
keeps the existing capability gating untouched, and removes nine legacy exports
in a single clean pre-1.0 break.

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/style/README.md` — current public surface and examples to update
- `packages/style/src/dynamicColors.ts` — the module being replaced
- `packages/style/src/dynamicColors.test.ts` — existing tests (will be replaced wholesale)
- `packages/style/src/createStyle.ts` — `style.rgb` / `style.hex` instance methods to rename
- `packages/style/src/index.ts` — public re-exports
- `packages/style/src/ansiCodes.ts` — `AnsiPair` type and existing close codes (`39m` fg, `49m` bg)
- `packages/style/src/styleEngine.ts` — `applyStyle` / `composeStyles` (do NOT modify)
- `packages/style/src/capability.ts` — capability gating (do NOT modify)
- `apps/docs/content/docs/modules/style.mdx` — only external consumer of the old API
- Bun.color reference: https://bun.com/docs/runtime/color (signature, formats, null-on-failure)

## Environment

- **Workspace:** `packages/style/` (primary), `apps/docs/` (docs only)
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `packages/style/src/color.ts` (new)
- `packages/style/src/color.test.ts` (new)
- `packages/style/src/dynamicColors.ts` (delete)
- `packages/style/src/dynamicColors.test.ts` (delete — superseded by `color.test.ts`)
- `packages/style/src/index.ts` (modify)
- `packages/style/src/createStyle.ts` (modify — rename `rgb`/`hex`/`bgRgb`/`bgHex` instance methods to `fg`/`bg`)
- `packages/style/src/styleMethodRegistry.ts` (review only — should not need changes)
- `packages/style/src/runtimeExports.ts` (modify if it re-exports old names)
- `packages/style/src/types.ts` (modify — add `ColorInput` type)
- `packages/style/README.md` (modify — replace dynamic-color examples)
- `apps/docs/content/docs/modules/style.mdx` (modify — replace dynamic-color examples)
- `taskplane-tasks/CONTEXT.md` (append tech-debt entry for depth-aware fallback follow-up)
- `.changeset/*.md` (new — minor bump with breaking-change note)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] Required files exist (`packages/style/src/dynamicColors.ts`, `apps/docs/content/docs/modules/style.mdx`)
- [ ] `bun install` completes cleanly
- [ ] Dependencies satisfied (none)

### Step 1: Plan checkpoint — lock API contract before implementation

> **Review override: plan review** — verify the API contract before any code is written.

Produce a short design note (in STATUS.md Notes section) confirming:

- [ ] `ColorInput` union type definition matches Bun.color's input surface (`string | number | { r, g, b, a? } | [r,g,b] | [r,g,b,a]`)
- [ ] Public exports finalized: `fg`, `bg`, `fgCode`, `bgCode`, `ColorInput` type. **No** `color`, `bgColor`, `parseColor`, `parseHex`, or any old name.
- [ ] Error contract: invalid input → `TypeError` with message `Invalid color input: <stringified input>` (wrap `Bun.color()`'s `null` return)
- [ ] Output format: `Bun.color(input, "ansi-16m")` for foreground open; background open derived by replacing leading `\x1b[38;` with `\x1b[48;`. fg close = `\x1b[39m`, bg close = `\x1b[49m` (matches existing `ansiCodes.ts` pairs)
- [ ] Style instance methods renamed: `style.rgb` / `style.hex` / `style.bgRgb` / `style.bgHex` → `style.fg` / `style.bg` (only two methods, not four)
- [ ] Empty-string input contract preserved: `fg("", any)` returns `""` (matches current `applyStyle` behavior)
- [ ] Confirm no other monorepo package consumes the old names (verified at task creation, but re-check with `grep -rn` to catch any drift)

**Do not start Step 2 until plan review verdict is APPROVE.**

### Step 2: Implement new color module

- [ ] Create `packages/style/src/color.ts` exporting `fg`, `bg`, `fgCode`, `bgCode` and the `ColorInput` type (or re-export from `types.ts`)
- [ ] Implement using `Bun.color(input, "ansi-16m")`; throw `TypeError` on `null`
- [ ] Background-open derivation: substring replace `\x1b[38;` → `\x1b[48;` on the foreground escape returned by Bun.color
- [ ] Add `ColorInput` to `packages/style/src/types.ts` and export from there
- [ ] Run targeted tests as you go: `cd packages/style && bun test src/color.test.ts` (will fail — test file written in Step 3)

**Artifacts:**
- `packages/style/src/color.ts` (new)
- `packages/style/src/types.ts` (modified)

### Step 3: Write new test suite

- [ ] Create `packages/style/src/color.test.ts` with coverage for:
  - [ ] Foreground escape parity for hex (3/6 digit), named, `rgb()`, `hsl()`, number, `{r,g,b}`, `[r,g,b]`
  - [ ] Background escape parity (open uses `48;`, close is `\x1b[49m`)
  - [ ] `fgCode` / `bgCode` return `AnsiPair` with correct `open` / `close`
  - [ ] Invalid inputs throw `TypeError` with the input embedded in the message
  - [ ] Empty-text input returns empty string (no escapes)
  - [ ] Nesting parity with static styles (fg close `39m` matches `codes.red.close`; bg close `49m` matches `codes.bgRed.close`) — port the relevant scenarios from the old `dynamicColors.test.ts`
  - [ ] `composeStyles` round-trip with `fgCode` + `bgCode` produces the expected layered escape
- [ ] Run targeted tests: `cd packages/style && bun test src/color.test.ts`

**Artifacts:**
- `packages/style/src/color.test.ts` (new)

### Step 4: Remove legacy module + rewire exports

- [ ] Delete `packages/style/src/dynamicColors.ts`
- [ ] Delete `packages/style/src/dynamicColors.test.ts` (superseded by `color.test.ts`)
- [ ] Update `packages/style/src/index.ts`: remove `parseHex`, `rgb`, `bgRgb`, `hex`, `bgHex`, `rgbCode`, `bgRgbCode`, `hexCode`, `bgHexCode` exports; add `fg`, `bg`, `fgCode`, `bgCode`, `ColorInput`
- [ ] Update `packages/style/src/runtimeExports.ts` if it re-exports any old names
- [ ] Update `packages/style/src/createStyle.ts`: rename `rgb` / `hex` / `bgRgb` / `bgHex` instance methods to `fg` / `bg` (collapse hex+rgb into single methods); update gating logic to call the new functions
- [ ] Run package tests: `cd packages/style && bun test`

**Artifacts:**
- `packages/style/src/dynamicColors.ts` (deleted)
- `packages/style/src/dynamicColors.test.ts` (deleted)
- `packages/style/src/index.ts` (modified)
- `packages/style/src/runtimeExports.ts` (modified if needed)
- `packages/style/src/createStyle.ts` (modified)

### Step 5: Update documentation

- [ ] `packages/style/README.md`: replace the "Dynamic Colors (Truecolor)" section's examples with the new `fg` / `bg` API; show the broader input surface (named colors, hsl, etc.); update the style-instance examples
- [ ] `apps/docs/content/docs/modules/style.mdx`: same update — lines 223 and 237 currently import old names
- [ ] `taskplane-tasks/CONTEXT.md`: append a tech-debt entry under "Tech Debt & Known Issues":
  > - [ ] **Depth-aware color fallback** — `fg` / `bg` always emit 24-bit truecolor (`ansi-16m`). Add detection that switches to `ansi-256` / `ansi-16` when the terminal does not support truecolor. Requires splitting `colorsEnabled` and `trueColorEnabled` gating in `createStyle.ts`. (Deferred from TP-001.)

**Artifacts:**
- `packages/style/README.md` (modified)
- `apps/docs/content/docs/modules/style.mdx` (modified)
- `taskplane-tasks/CONTEXT.md` (appended)

### Step 6: Code review checkpoint

> **Review override: code review** — verify implementation matches the contract from Step 1.

The reviewer must confirm:

- [ ] All nine legacy exports are gone from `index.ts` and not re-introduced via `runtimeExports.ts`
- [ ] Foreground / background escape strings produced by the new API are byte-identical to what the old API produced for the same color (sample: `#ff0000`, `#0080ff`, `(0, 128, 255)`)
- [ ] Capability gating in `createStyle.ts` still suppresses output correctly when truecolor is disabled
- [ ] No other package in the monorepo imports a removed name (re-grep `apps/`, `packages/`)
- [ ] Tests cover all `ColorInput` variants and the invalid-input throw

### Step 7: Add changeset

- [ ] Run `bunx changeset` and select `@crustjs/style` with a **minor** bump
- [ ] Body must:
  - [ ] State this is a **breaking change** for direct consumers of `rgb`, `bgRgb`, `hex`, `bgHex`, `parseHex`, `rgbCode`, `bgRgbCode`, `hexCode`, `bgHexCode`, `style.rgb`, `style.hex`, `style.bgRgb`, `style.bgHex`
  - [ ] Show a one-line migration: `rgb(text, r, g, b)` → `fg(text, [r, g, b])`; `hex(text, "#ff0000")` → `fg(text, "#ff0000")`
  - [ ] Note the new capabilities: named colors, `rgb()`, `hsl()`, etc.

**Artifacts:**
- `.changeset/*.md` (new)

### Step 8: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `bun run test`
- [ ] Run lint: `bun run check`
- [ ] Run type-check: `bun run check:types`
- [ ] Run build: `bun run build`
- [ ] Fix all failures

### Step 9: Documentation & Delivery

- [ ] "Must Update" docs modified (verified in Step 5)
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `packages/style/README.md` — replace `Dynamic Colors (Truecolor)` section examples with the new `fg` / `bg` API
- `apps/docs/content/docs/modules/style.mdx` — replace dynamic-color import + example blocks (currently lines 223 and 237)
- `taskplane-tasks/CONTEXT.md` — append depth-fallback tech-debt entry

**Check If Affected:**
- `packages/style/CHANGELOG.md` — auto-updated by Changesets; do **not** hand-edit
- Any other `.mdx` / `.md` in `apps/docs/` that mentions dynamic colors (grep for `rgb(`, `hex(`, `bgRgb`, `bgHex`)
- `AGENTS.md` / `CONTRIBUTING.md` — unlikely affected, but skim

## Completion Criteria

- [ ] All steps complete
- [ ] `bun run check && bun run check:types && bun run test && bun run build` all pass
- [ ] Plan-review verdict APPROVE before Step 2; code-review verdict APPROVE before Step 7
- [ ] Changeset present in `.changeset/`
- [ ] No grep hits for removed names anywhere outside `.changeset/` and this task folder

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-001): complete Step N — description`
- **Bug fixes:** `fix(TP-001): description`
- **Tests:** `test(TP-001): description`
- **Hydration:** `hydrate: TP-001 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message
- Implement depth-aware fallback (`ansi-256` / `ansi-16`) — explicitly deferred
- Keep any of the old exports as deprecated shims — this is a clean break
- Modify `styleEngine.ts`, `capability.ts`, or `ansiCodes.ts`
- Hand-edit `CHANGELOG.md` files
- Introduce a new public `parseColor` / `parseHex` — Bun.color is the only parser
- Change the `AnsiPair` type or the close codes (`\x1b[39m` / `\x1b[49m`)

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
