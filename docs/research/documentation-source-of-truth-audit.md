# Documentation single-source-of-truth audit

**Repository:** `chenxin-yan/crust`

**Historical baseline HEAD:** `6afef3d3ca04bd941507298d074d1b54a775c54a`

**Method:** three parallel sub-agent audits, followed by a consolidation sub-agent and parent verification. Only this research report was added to the repository. Documentation pages, source examples, implementation, and dependencies were unchanged.

## 1. Direct answer

**Only partly.** Selected reference tables are genuinely generated from TypeScript source and JSDoc. Most callable signatures, small aliases/unions, export inventories, CLI option/target tables, examples, and behavioral explanations remain hand-authored.

- **62 `<auto-type-table>` markers across 15 of 41 MDX pages** read package source declarations. All 62 referenced files and directly exported declaration names passed a static existence check.
- **The main Core builder/method reference is manual:** `apps/docs/content/docs/api/crust.mdx:28-432` contains no generated type tables. The documentation explicitly describes its builder signatures as simplified (`:30-34`).
- **Examples already have a useful reuse mechanism:** 13 `<include>` references across five pages reuse real TypeScript files. Those files fall within the docs TypeScript project's include patterns; ordinary MDX code fences do not.
- **Runtime command documentation has its own existing single source:** command definitions → `CommandSnapshot` → `buildCommandDocumentation()`, used by help, completion, man, and skills. That model does **not** currently generate the website's CLI option tables.
- **Confirmed discrepancies are small:** a root-versus-tooling scope inconsistency and an omitted `readonly` modifier in the manual `VersionOptions` sketch. No broader runtime/default mismatch was established by this audit's selected comparisons.
- **The clearest maintenance gap is CI:** package-source-only changes do not trigger the docs workflow, even though generated tables directly depend on package source.

**Bottom line:** preserve and extend the existing Fumadocs and source-include mechanisms. Do not replace the documentation site with a new generator, and do not mistake type generation for verification of runtime behavior.

## 2. Current generation architecture

### Website reference pipeline

```text
Package TypeScript declarations + property JSDoc
          │ explicit <auto-type-table path="…" name="…">
          ▼
Fumadocs TypeScript / ts-morph
          ▼
Generated TypeTable MDX within otherwise authored pages
          ▼
Fumadocs compiled collections / shared source loader
          ├── Website MDX renderer
          ├── Search structured data
          └── Processed Markdown / LLM routes

Authored MDX/frontmatter/navigation ────────────────┘
Real example .ts files ── <include> ───────────────┘
```

**Project configuration.** `apps/docs/source.config.ts:3-12` creates a `fumadocs-typescript` generator using `tsconfig.json` and a filesystem cache. Lines `14-27` configure the docs collection, enable processed Markdown, and install `remarkAutoTypeTable`. Versions are pinned in `apps/docs/package.json:18-21`: Fumadocs Core/UI 16.14.5, MDX 15.3.0, and TypeScript integration 5.3.0.

**What is extracted.** The installed generator resolves a named exported declaration and enumerates its properties, using ts-morph (`apps/docs/node_modules/fumadocs-typescript/dist/index.js:63-108`). Property types, optionality, descriptions, and JSDoc tags are extracted at `:111-159`; `@internal` properties are skipped by default. The renderer consumes tags such as `@default`, `@returns`, and `@param` at `:192-222`.

This is **property-table generation**, not an exact public declaration emitter. In particular, the implementation does not provide a separate readonly-modifier field, and property enumeration is not equivalent to preserving every union branch, generic constraint, call signature, constructor, and overload. A successful marker is not proof that its table expresses the entire TypeScript contract.

**Compilation and rendering.** The plugin replaces markers with `TypeTable` MDX elements containing serialized documentation data, and reports missing names/invalid attributes with contextual errors (`apps/docs/node_modules/fumadocs-typescript/dist/index.js:9-24,224-318`). Fumadocs processes includes and configured remark plugins before postprocessing (`apps/docs/node_modules/fumadocs-mdx/dist/build-default-LB5TcE_V.js:90-143`). The site loads compiled collections through `apps/docs/src/lib/source.ts:1-9`, then explicitly registers `TypeTable` when rendering MDX (`apps/docs/src/routes/docs/$.tsx:57-93`).

### Search and LLM consumers

These consumers reuse compiled documentation; they do not independently inspect package types or repair manual drift.

| Consumer                | Existing source and behavior                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website                 | Shared source/frontmatter loader at `apps/docs/src/routes/docs/$.tsx:38-55`; browser MDX renderer at `:57-93`.                                                                                                               |
| Search                  | `apps/docs/src/routes/api/search.ts:1-17` calls `createFromSource(source)`. Fumadocs uses page indexes/structured data, not a separate API inventory (`apps/docs/node_modules/fumadocs-core/dist/search/server.js:184-220`). |
| `/llms.txt`             | Page-title/description index, generated from the shared source; not full API text (`apps/docs/src/routes/llms[.]txt.ts:5-16`).                                                                                               |
| `/llms-full.txt`        | Concatenates `getLLMText()` for every page (`apps/docs/src/routes/llms-full[.]txt.ts:5-15`); that helper requests processed Markdown (`apps/docs/src/lib/source.ts:11-16`).                                                  |
| Per-page Markdown route | Returns `page.data.getText("processed")` (`apps/docs/src/routes/llms[.]mdx.docs.$.ts:5-17`).                                                                                                                                 |

The installed stringifier preserves `TypeTable` elements and serializes their attributes (`apps/docs/node_modules/fumadocs-core/dist/mdx-plugins/stringifier.js:4-64`). Structure extraction accepts empty-child MDX elements (`apps/docs/node_modules/fumadocs-core/dist/mdx-plugins/remark-structure.js:8-18,54-87`), and the LLM plugin stringifies processed MDX while excluding ESM (`apps/docs/node_modules/fumadocs-core/dist/mdx-plugins/remark-llms.js:8-37`). Thus generated data can flow downstream as component markup/serialized data—not necessarily as an ordinary readable Markdown table. No rendered search or LLM response was exercised here.

### Separate runtime documentation pipeline

`packages/core/src/command/snapshot.ts:116-195` projects command definitions into snapshots, including effective flags, negation policy, defaults, and child commands. `packages/core/src/command/documentation.ts:149-224` converts snapshots into presentation-neutral usage, argument, flag-spelling, section, and visible-child data.

Existing consumers include:

- Help: `packages/extensions/src/help.ts:81-86`.
- Completion: `packages/extensions/src/completion/index.ts:80-96`.
- Man: `packages/man/src/mdoc.ts:86-110`.
- Skills: `packages/skills/src/manifest.ts:15-38`.

The public seam is `@crustjs/core/tooling`, exported at `packages/core/src/tooling.ts:9-22`. This is the existing-tool-first choice for mechanical CLI documentation. It cannot supply defaults that are calculated later in an action or planner, or infer a schema's behavior.

### Metadata remains authored

Page titles/descriptions come from MDX frontmatter, and navigation/order comes from `meta.json`; neither is inferred from types. Examples: `apps/docs/content/docs/api/index.mdx:1-4`, `apps/docs/content/docs/api/meta.json:1-5`, and `apps/docs/content/docs/modules/meta.json:1-18`.

## 3. Page and package coverage inventory

### Counts and interpretation

| Surface                              | MDX pages | Pages with type tables | Type-table markers |
| ------------------------------------ | --------: | ---------------------: | -----------------: |
| API                                  |         4 |                      2 |                 21 |
| Guides                               |        16 |                      2 |                  2 |
| Modules, including nested Extensions |        19 |                     11 |                 39 |
| Landing and quick start              |         2 |                      0 |                  0 |
| **Total**                            |    **41** |                 **15** |             **62** |

All 15 table-bearing pages also contain authored content. The other 26 pages have **no auto type tables**; that does not mean all their content is duplicated, because some use source includes. No whole-page/public-API generation was found.

The following paths are relative to the exact directory **`apps/docs/content/docs/`**. Ranges identify the inspected page or generated blocks; counts are marker counts, not percentages of API facts covered.

### API pages

| Page                   | Tables | Coverage                                                                                                                                                                                                                             |
| ---------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api/index.mdx:1-37`   |      0 | Manual runtime export overview and tooling boundary.                                                                                                                                                                                 |
| `api/crust.mdx:1-432`  |      0 | Manual builder, definitions, constructor, methods, invocation and lifecycle prose.                                                                                                                                                   |
| `api/types.mdx:1-344`  |     16 | Tables at `:33,60,104,129-142,170-181,222-225,249-252,268-277,311-338`; selected definitions, snapshots, I/O, Context and Extension contracts. Aliases, helper signatures, typed invocation and much explanatory text remain manual. |
| `api/errors.mdx:1-117` |      5 | `CrustErrorDetailsMap` plus four detail interfaces at `:65-86`; class, code union, meanings and propagation prose remain manual.                                                                                                     |

### Guides and entry pages

| Page                             | Tables | Other source reuse                                                     |
| -------------------------------- | -----: | ---------------------------------------------------------------------- |
| `guide/index.mdx:1-12`           |      0 | —                                                                      |
| `guide/commands.mdx:1-94`        |      1 | `CrustCommandContext` at `:51-54`.                                     |
| `guide/arguments.mdx:1-84`       |      0 | —                                                                      |
| `guide/flags.mdx:1-137`          |      0 | —                                                                      |
| `guide/types.mdx:1-133`          |      0 | —                                                                      |
| `guide/subcommands.mdx:1-94`     |      0 | —                                                                      |
| `guide/extensions.mdx:1-205`     |      1 | `ExtensionContext` at `:205`; four includes at `:10-12,30-32,174,195`. |
| `guide/contexts.mdx:1-97`        |      0 | —                                                                      |
| `guide/lifecycle.mdx:1-65`       |      0 | —                                                                      |
| `guide/split-files.mdx:1-48`     |      0 | Four includes at `:12-14,22-24,32-34,40-42`.                           |
| `guide/environment.mdx:1-42`     |      0 | —                                                                      |
| `guide/runtimes.mdx:1-34`        |      0 | —                                                                      |
| `guide/error-handling.mdx:1-100` |      0 | One include at `:62`.                                                  |
| `guide/build.mdx:1-390`          |      0 | CLI flags, targets and packaging are authored.                         |
| `guide/development.mdx:1-37`     |      0 | —                                                                      |
| `guide/testing.mdx:1-115`        |      0 | —                                                                      |
| `index.mdx:1-80`                 |      0 | One include at `:23-25`.                                               |
| `quick-start.mdx:1-44`           |      0 | Three includes at `:16-18,29,35`.                                      |

### Modules

| Page                                           | Tables | Generated coverage / manual boundary                                                                                                      |
| ---------------------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/index.mdx:1-28`                       |      0 | Manual package overview.                                                                                                                  |
| `modules/core.mdx:1-214`                       |      0 | Manual Core export/type tables and tooling overview.                                                                                      |
| `modules/crust.mdx:1-39`                       |      0 | Build CLI overview; links to guide.                                                                                                       |
| `modules/create-crust.mdx:1-41`                |      0 | Manual scaffold CLI options.                                                                                                              |
| `modules/create.mdx:1-215`                     |      3 | `ScaffoldOptions`, `ScaffoldResult`, `PostScaffoldStep` at `:106,128,149`.                                                                |
| `modules/man.mdx:1-118`                        |      3 | Extension, writer and mdoc options at `:29,37-40,65-68`.                                                                                  |
| `modules/skills.mdx:1-177`                     |      3 | Write/extension/install options at `:46,80,126`. Agent lists/paths and behavior remain authored.                                          |
| `modules/progress.mdx:1-206`                   |      6 | Spinner/progress options and handles, theme at `:50,72-77,95-105,159`.                                                                    |
| `modules/prompts.mdx:1-492`                    |      7 | Seven prompt option interfaces at `:126,143-146,193-196,217-220,242-245,261-264,290-293`. Renderer/theme/export inventory remains manual. |
| `modules/store.mdx:1-533`                      |      5 | Creation options, field/store/permission/issue types at `:178,503-517`. Error tables and persistence behavior remain manual.              |
| `modules/style.mdx:1-195`                      |      4 | Style/capability/hyperlink/table options at `:183-189`; exports and mode unions are manual.                                               |
| `modules/testing.mdx:1-104`                    |      2 | `CapturedExecute` at `:78`, `InteractiveRun` at `:100`; `ExecutableApp` and `CapturedRun` are manual.                                     |
| `modules/extensions/index.mdx:1-61`            |      0 | Manual extension inventory.                                                                                                               |
| `modules/extensions/help.mdx:1-52`             |      0 | Manual behavior/API.                                                                                                                      |
| `modules/extensions/version.mdx:1-56`          |      0 | Manual factory/options/union.                                                                                                             |
| `modules/extensions/completion.mdx:1-189`      |      1 | `CompletionOptions` at `:90-93`; shells/renderers/filenames are manual.                                                                   |
| `modules/extensions/did-you-mean.mdx:1-41`     |      1 | `DidYouMeanOptions` at `:32-35`.                                                                                                          |
| `modules/extensions/no-color.mdx:1-34`         |      0 | Manual behavior/API.                                                                                                                      |
| `modules/extensions/update-notifier.mdx:1-124` |      4 | Options, cache config/adapter and state at `:26-29,85-100`.                                                                               |

### Package/public-subpath and README coverage

There are **14 package directories: 12 publishable packages and two private packages**. Each publishable package has a module surface and `packages/<directory>/README.md`:

| Package directory                                                  | Package/module coverage                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `core`                                                             | `@crustjs/core`: API pages plus `modules/core.mdx`. Root and `./tooling` are separate public entry points.      |
| `extensions`                                                       | `@crustjs/extensions`: nested module overview plus six extension pages.                                         |
| `crust`                                                            | `@crustjs/crust`: CLI module plus build guide; CLI metadata, not a library declaration reference.               |
| `create-crust`                                                     | Unscoped `create-crust`: scaffold CLI module and README.                                                        |
| `create`, `man`, `progress`, `skills`, `store`, `style`, `testing` | Corresponding `@crustjs/*` module pages and package READMEs.                                                    |
| `prompts`                                                          | `@crustjs/prompts`: module page also discusses custom-prompt testing; `./testing` is a separate public subpath. |
| `utils`                                                            | Private `@crustjs/utils`; internal README, no public module page.                                               |
| `config`                                                           | Private `@crustjs/config`; no package README/public module page.                                                |

Entry-point evidence: `packages/core/package.json:29-38`, `packages/core/src/index.ts:1-87`, `packages/core/src/tooling.ts:9-22`, and `packages/prompts/package.json:29-38`. Private-package evidence: `packages/utils/package.json:1-17` and `packages/config/package.json:1-6`. Root package listings are authored at `README.md:38-54`.

This inventory establishes **page presence**, not exhaustive documentation of every exported symbol. In particular, public Core generic/helper types may be merely named or explained without exact declarations, and prompts' testing subpath is not a generated subpath reference.

## 4. Confirmed discrepancies—not speculative drift

### D1. API overview contradicts its own root/subpath scope

- **Documentation:** `apps/docs/content/docs/api/index.mdx:8` says, “All exports on these pages come from `@crustjs/core`.” Lines `28-36` then describe helpers exported from `@crustjs/core/tooling`.
- **Code/metadata:** `packages/core/package.json:29-38` defines distinct root and tooling entry points; `packages/core/src/tooling.ts:9-22` owns the helpers, while `packages/core/src/index.ts:1-87` does not re-export them from the root.
- **Classification:** confirmed editorial scope inconsistency, **not** a demonstrated broken import example. The warning already gives the correct subpath.
- **Smallest recommendation:** scope the introduction to root APIs and explicitly acknowledge the tooling section. No new page or generator is necessary to fix this.

### D2. The manual VersionOptions sketch loses a readonly guarantee

- **Documentation:** `apps/docs/content/docs/modules/extensions/version.mdx:27-29` declares `format?` without `readonly`.
- **Authoritative declaration:** `packages/extensions/src/version.ts:14-22` declares `readonly format?`.
- **Classification:** confirmed declaration-level omission, not evidence of a runtime failure or that an existing application example fails compilation. The sketch presents a looser mutability contract than the source. Generic defaults/constraints are also abbreviated elsewhere, but those broader sketches should not automatically be called semantic bugs.

**Smallest recommendation:** restore the modifier or replace/link the small declaration using the existing source-reuse mechanism. An options property table alone is not a complete exact-declaration replacement: the current generator does not separately expose readonly metadata.

### What was not confirmed

The rechecked Core value literals/error codes, build/publish option inventories, six Bun and six Deno targets, create-crust option names, completion shell union, and testing return union agreed on the compared facts. **That is sampling, not a claim of full semantic parity across all pages.**

The principal proven problems are therefore small declaration/editorial discrepancies and missing maintenance checks—not widespread incorrect runtime documentation.

## 5. Ranked coverage gaps and potential drift

Priorities below are remediation order, not incident severity. **P1** means highest maintenance value; **P2** means useful follow-up. These are not additional confirmed content mismatches.

### P1 — Package changes can bypass docs validation

**Evidence:** the generated table in `apps/docs/content/docs/api/types.mdx:170` directly names `packages/core/src/types.ts`, whose I/O declaration is at `:8-13`. The generator is installed at `apps/docs/source.config.ts:23-27`. Yet `.github/workflows/ci-docs.yml:3-12` watches docs/root config inputs, **not `packages/**`**.

Docs CI performs typechecking, lint/format checks and a build (`.github/workflows/ci-docs.yml:45-54`). Package CI watches package changes, but its build/typecheck/test command filters to packages and tools rather than the docs app (`.github/workflows/ci-packages.yml:3-17,122-125`).

**Risk:** a type/JSDoc move or package API change can invalidate a generated table or included example without starting the workflow that validates the site. This is a confirmed workflow-coverage gap; no failed deployment was demonstrated.

**Recommendation:** add package-source changes to the docs workflow trigger. Use the existing docs build to resolve markers; do not first add a redundant standalone marker validator.

### P1 — Exact Core callable/generic contracts are mostly duplicated or absent

| Manual doc surface                                                                                                      | Canonical source                                             | Gap                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builder and `defineCommand`: `apps/docs/content/docs/api/crust.mdx:28-116`                                              | `packages/core/src/command/crust.ts:264-284,377-476,613-657` | Handwritten sketches omit portions of generic accumulation/validation/refined returns. The builder simplification is explicitly disclosed—not itself confirmed drift. |
| Constructor/class: `apps/docs/content/docs/api/crust.mdx:118-150`                                                       | `packages/core/src/command/crust.ts:230-234,829-893`         | Manual class/metadata sketch, not emitted declaration output.                                                                                                         |
| `args` through `command`: `apps/docs/content/docs/api/crust.mdx:156-350`                                                | `packages/core/src/command/crust.ts:935-1164`                | Manual method signatures; exact generic results and constraints live only in code/editor declarations.                                                                |
| `run`: `apps/docs/content/docs/api/crust.mdx:367-410`; typed invocation: `apps/docs/content/docs/api/types.mdx:146-164` | `packages/core/src/command/crust.ts:110-218,1215-1241`       | Public `CommandShape`, `CommandPath`, `CommandShapeAt`, `RunInput`, tuple inputs and `RunOutcome` are described manually, not given an exact generated contract.      |
| Context helpers: `apps/docs/content/docs/api/types.mdx:185-245`                                                         | `packages/core/src/api/context.ts:15-82,154-204`             | `ContextInstance` has a table; Context factory/config/setup/bag and helper/overload treatment is largely manual.                                                      |
| Extension factories/aliases: `apps/docs/content/docs/api/types.mdx:247-340`                                             | `packages/core/src/api/extension.ts:183-225,238-320,330-390` | Seven selected tables, but manual aliases/factory summary and no generated exact `defineExtension` overload reference.                                                |

**Recommendation:** retain concise conceptual summaries, consistently label them, and link to exact source/declarations. Expand auto tables for appropriate object interfaces—not indiscriminately for conditional aliases, literal unions or overloaded callables. If readable exact excerpts are needed, reuse the installed include/TypeScript tooling rather than introduce a second API-generation stack.

### P1 — Mechanical CLI tables duplicate runtime definitions

| Documentation                                                                                                        | Code owning the facts                              | Assessment                                                              |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Build flags: `apps/docs/content/docs/guide/build.mdx:42-57`                                                          | `packages/crust/src/commands/build.ts:578-663`     | Names, aliases, declared defaults and descriptions are hand-maintained. |
| Build runtimes/targets: `apps/docs/content/docs/guide/build.mdx:59-90`                                               | `packages/crust/src/utils/build-helpers.ts:20-153` | Three runtimes and two six-target inventories are manually repeated.    |
| Publish flags: `apps/docs/content/docs/guide/build.mdx:308-315`                                                      | `packages/crust/src/commands/publish.ts:211-249`   | Six option rows duplicate the command definition.                       |
| Scaffolder options: `apps/docs/content/docs/modules/create-crust.mdx:24-39`; `packages/create-crust/README.md:21-31` | `packages/create-crust/src/index.ts:41-69,74-142`  | CLI options and prompt defaults are repeated in both docs surfaces.     |

**Recommendation:** reuse `CommandSnapshot`/`buildCommandDocumentation()` for usage and declared options, or start with a narrow parity test if maintaining curated tables is simpler. Reuse target constants for target inventories.

**Important limit:** a snapshot cannot supply every displayed effective default. Build `minify` deliberately has no definition default (`packages/crust/src/commands/build.ts:602-607`); its effective default is computed by runtime at `:468`. Scaffolder defaults are prompt configuration (`packages/create-crust/src/index.ts:109-141`), not all command-definition defaults. Preserve/check those runtime qualifications rather than presenting an incomplete generated table as authoritative.

### P2 — Small aliases, error codes and export inventories remain duplicate maintenance

- **Core literals/codes:** manual `ValueType` at `apps/docs/content/docs/api/types.mdx:10-23` versus `packages/core/src/types.ts:25-40`; manual error union/table at `apps/docs/content/docs/api/errors.mdx:48-59` versus `packages/core/src/errors.ts:45-50,79-85`. They currently match the compared values. The generated error map already supplies a canonical key set.
- **Tooling reference:** `apps/docs/content/docs/api/index.mdx:28-36` names the tooling surface, and `apps/docs/content/docs/modules/core.mdx:196-212` provides an authored behavior table. Exact model/function declarations live at `packages/core/src/tooling.ts:9-22` and `packages/core/src/command/documentation.ts:9-27,37-147,219-224`. It is inaccurate to call tooling undocumented; it is **not an exact generated API reference**.
- **Completion:** manual shell/type/render-function block at `apps/docs/content/docs/modules/extensions/completion.mdx:79-87` versus `packages/extensions/src/completion/index.ts:23-55,123-129`; selected options are generated at doc `:90-93`. Runtime shell filenames and fallback versions are separate implementation facts (`completion/index.ts:58-96`).
- **Testing:** manual `ExecutableApp`/`CapturedRun` at `apps/docs/content/docs/modules/testing.mdx:18-24,48-59` versus `packages/testing/src/index.ts:32-39,82-85`; two other result interfaces already use auto tables.
- **Broader module inventories:** prompt exports/theme facts are authored at `apps/docs/content/docs/modules/prompts.mdx:297-317,408-480`; skills agent groups/path prose at `apps/docs/content/docs/modules/skills.mdx:92-107` duplicates types/registry facts from `packages/skills/src/agents.ts:10-65` and the subsequent registry. These remain author-maintained even though adjacent option tables are generated.

**Recommendation:** generate or parity-check small mechanical lists only where useful. For a literal union or complete callable signature, first verify the existing property-table renderer can express the intended information; otherwise prefer a source excerpt/link or a small targeted use of the already installed TypeScript tooling.

### P2 — Package READMEs and published entry points are not mechanically inventoried

`packages/extensions/README.md:33-47` lists runtime exports and three completion types. The barrel additionally exports `DidYouMeanOptions`, notifier types, and version types (`packages/extensions/src/index.ts:12-26`).

**Classification:** incomplete type inventory, not necessarily a false completeness promise: “Import all exports from …” can describe the import location rather than promise an exhaustive list. The module pages already cover several omitted types. Do not inflate this into missing runtime APIs or a broken README example.

Package names, exports, engine floors and install commands are metadata facts. Runtime floors at `apps/docs/content/docs/guide/runtimes.mdx:6-8` agree with the checked Core manifest (`packages/core/package.json:65-68`), and package CI explicitly smoke-tests documented floors (`.github/workflows/ci-packages.yml:44-61`). This is useful existing behavioral coverage, not generation of the prose from `engines`.

**Recommendation:** clearly label curated export inventories; if exhaustive coverage is intended, compare them against package export maps and barrels. Do not expose every source-file export as public: the package root, supported subpaths and internal source helpers are different boundaries.

### P2 — Source-included examples are checked differently from MDX fences

**Existing good behavior:** 13 include targets resolve to actual files under `apps/docs/examples`; docs `tsconfig.json:1-2` includes `**/*.ts` and `**/*.tsx`, and `apps/docs/package.json:10` runs `tsc --noEmit` after MDX setup. Thus those source examples are within the configured typecheck project. `apps/docs/examples/package.json:1-6` is an import anchor, not a separate typecheck boundary.

Examples include:

- `apps/docs/content/docs/quick-start.mdx:16-18,29,35` → `apps/docs/examples/quick-start/{starter,subcommand,invoke}.ts`.
- `apps/docs/content/docs/guide/split-files.mdx:12-14,22-24,32-34,40-42` → the corresponding split-file TypeScript files.
- `apps/docs/content/docs/guide/extensions.mdx:10-12,30-32,174,195` and `guide/error-handling.mdx:62` → shared extension examples/regions.

**Remaining risk:** a normal `ts` code fence is Markdown, not a TypeScript project input. Manual module examples such as `apps/docs/content/docs/modules/testing.mdx:32-46` and signature fences throughout `api/crust.mdx` have no configured extraction/typecheck gate (`apps/docs/source.config.ts:23-35`, `apps/docs/tsconfig.json:1-24`). This does not mean the examples are wrong; some intentionally omit surrounding setup.

**Recommendation:** move only high-risk, intended-to-compile examples to existing included `.ts` files. Do **not** add a new example typecheck project merely to check files already included by the docs project, and do not try to compile deliberately conceptual pseudo-signatures as applications.

## 6. What types can—and cannot—generate

| Fact                                                                                                   | Appropriate source                                         | Existing status / limit                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property names, property types and optionality                                                         | TypeScript declarations                                    | Already generated for selected types.                                                                                                                                                             |
| Exact generic constraints, readonly modifiers, constructors, overloads and conditional types           | Source or emitted `.d.ts`                                  | Derivable from declarations, but not fully represented by the current property-table pipeline.                                                                                                    |
| Descriptions, deprecation, documented defaults and parameter notes                                     | JSDoc                                                      | Selected tags already flow into tables. A generated `@default` is still an authored assertion, not runtime verification.                                                                          |
| Literal unions and exported symbol inventories                                                         | Declarations/barrels and package export maps               | Mostly manual today. Public visibility requires entry-point awareness, not just `export` inside a source file.                                                                                    |
| CLI names, short/long aliases, choices and declared defaults                                           | Runtime command definitions/snapshots                      | Existing snapshot/documentation model supports reuse; website CLI tables remain authored.                                                                                                         |
| Computed defaults, prompt behavior, environment precedence, filenames, error timing and disposal order | Runtime implementation and behavioral tests                | Types alone cannot establish them. Generate from runtime metadata where available; otherwise retain tested prose.                                                                                 |
| Serialization/freezing and schema execution                                                            | Runtime implementation                                     | A readonly interface does not prove deep freezing, serializability or schema behavior. See `packages/core/src/command/snapshot.ts:116-195` and `packages/core/src/command/invocation.ts:215-235`. |
| Package names, install commands, supported subpaths and engines                                        | `package.json`, packaging configuration and runtime checks | Metadata—not type facts.                                                                                                                                                                          |
| Examples, guidance and rationale                                                                       | Authored text + included/checked examples                  | Keep authored. Arbitrary example literals are not global API defaults.                                                                                                                            |
| Frontmatter, navigation and page grouping                                                              | MDX/frontmatter and `meta.json`                            | Intentionally authored.                                                                                                                                                                           |

For example, the `json` action-facing type is `unknown` (`packages/core/src/types.ts:31-40`); structured input compatibility has a separate contract (`packages/core/src/command/crust.ts:179-208`). Neither fact alone proves the runtime validates or serializes supplied JSON values. Similarly, `ParseErrorDetails.value` remains in the type but its JSDoc says Core no longer populates it (`packages/core/src/errors.ts:29-36`). Removing narrative/JSDoc in favor of bare property types would lose important information.

## 7. Smallest useful improvement plan

1. **Fix the small confirmed wording/declaration discrepancies.** Keep code and examples untouched until an implementation change is requested.
2. **Close the docs CI trigger gap.** Run the existing docs checks/build for package-source changes. This protects existing generation before expanding it.
3. **Keep Fumadocs.** Add selected object-interface tables where useful; keep simplified signatures clearly labeled and link to exact declarations. Do not assume adding an auto table for every exported name yields a complete API reference.
4. **Use existing source includes for executable examples.** The docs TypeScript project already covers those files. Convert selectively, not every explanatory fence.
5. **Reuse the runtime documentation model for CLI inventories.** Start with build/publish option parity or generated rows; use existing target constants. Keep planner/prompt defaults explicitly separate.
6. **Add mechanical export/metadata checks only where an exhaustive inventory is intended.** Curated package summaries need not become generated registries.

No new documentation dependency, API-extraction framework, generated-page hierarchy or blanket prose generator is justified by the evidence. Package declarations already use tsdown; retain the repository's accepted isolated-declarations setup rather than changing declaration architecture to serve docs (`docs/adr/0001-isolated-declarations.md:7-22`).

## 8. Validation, reconciled claims and limitations

### Work performed

- Read all three supplied research reports completely and deduplicated their architecture, API and module findings.
- Read repository `AGENTS.md`, applicable domain guidance (`docs/agents/domain.md`) and the declaration-build ADR. Issue-tracker/triage procedures were not applicable to this local research task.
- Verified HEAD and clean Git status at the beginning and again during final verification: HEAD remained `6afef3d3ca04bd941507298d074d1b54a775c54a`, with no working-tree changes. Findings are qualified to this local snapshot.
- Independently enumerated all 41 MDX pages, all 62 type-table markers and all 13 includes using read-only local scripts.
- Checked every marker's referenced path and direct exported declaration name. Checked include target files and the presence of named regions; this was not full Fumadocs compilation.
- Re-read the generation configuration, installed relevant Fumadocs implementation, route consumers, CI workflows, package public barrels/maps, the Core API pages, and selected high-value module/guide facts against source.
- Inspected runtime lifecycle code and an existing Context/onError test where a possible contradiction needed resolving.

### Conflicts and unsupported claims resolved

1. **Included examples are within the docs typecheck project.** The generation report's suggestion that they are outside established typecheck coverage is not supported by `apps/docs/tsconfig.json:1-2`. Configuration coverage is confirmed; a successful current typecheck was not run.
2. **The error page has five tables:** one map plus four detail interfaces—not five detail interfaces. Its actual length is 117 lines, not the shorter inventory in one supplied report.
3. **Simplified signatures are not automatically bugs.** The explicit builder callout is retained in the assessment. Internal/phantom-field omission is not treated as missing supported API behavior. Final reinspection confirms that `ContextBag` already includes `readonly` at `apps/docs/content/docs/api/types.mdx:207-209`; no missing-readonly finding is made for it.
4. **Tooling is documented, but manually.** The API warning and `modules/core.mdx` tooling table rule out a blanket “no tooling documentation” claim.
5. **`onError` is not uniformly before or after disposal.** The example at `apps/docs/content/docs/api/errors.mdx:92` should not be declared categorically false: ordinary invocation failures render while Contexts are live, but failures after post-run/cleanup can use a disposed resolver. Evidence: `packages/core/src/command/invocation.ts:189-193,247-277,293-296,427-459`; the normal live-Context path is covered by `packages/core/src/command/crust.test.ts:1579-1608`. This audit does not promote that nuanced wording to confirmed drift.
6. **Generated does not mean exhaustive or runtime-verified.** Static marker resolution does not prove complete union/overload rendering, JSDoc accuracy, rendered output quality, or a current deployed site's contents.

### Limitations

This is a **complete marker/page-presence inventory, not an exhaustive semantic audit**. Deep comparisons were concentrated on the Core public surface, generation/CI architecture, and high-risk mechanical CLI/module facts. The supplied module report surveyed the broader package README/module surface; the consolidation independently rechecked selected findings rather than every README sentence and every source declaration.

No docs build, TypeScript check, package test, CLI invocation, declaration emission, browser/search test or deployed-output comparison was run. Installed dependency implementation was inspected as supporting local evidence, not treated as proof of published output. Cache invalidation across transitive type changes and final rendered table completeness were not validated.

Four sub-agents performed the research and consolidation. No documentation pages, implementation, or examples were edited, no packages were installed, and no commits were created. Only this research report was added.
