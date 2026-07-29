# Domain Docs

This repo uses a single-context layout: `CONTEXT.md` and `docs/adr/` live at the repo root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If either doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates these files lazily when terms or decisions actually get resolved.

## File structure

This is a Turborepo monorepo. Application code lives under `apps/*`; published package code lives under `packages/*/src`.

```text
/
├── CONTEXT.md
├── apps/
│   └── docs/
├── docs/
│   └── adr/
│       ├── 0001-use-extension-as-public-integration-contract.md
│       └── 0002-model-contexts-as-command-dependencies.md
└── packages/
    ├── core/src/
    └── extensions/src/
```

The two ADRs shown are examples; read the complete `docs/adr/` directory for decisions relevant to the area you are changing.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (use Extension as the public integration contract) — but worth reopening because…_
