---
"@crustjs/skills": patch
---

# Make `agents` optional on `generateSkill`, `uninstallSkill`, and `skillStatus`

The `agents` field on `GenerateOptions`, `UninstallOptions`, and
`StatusOptions` is now optional. When omitted, all three entrypoints default
to:

```ts
[...getUniversalAgents(), ...(await detectInstalledAgents())];
```

— the union of always-included universal agents and additional agents
detected on the current machine.

**Behavior change.** Omitting `agents` performs filesystem I/O via
`detectInstalledAgents()` to probe `PATH` for installed agent CLIs.
Previously these functions did no I/O for agent resolution because the
caller always supplied the list. Pass an explicit array (including the
empty array, which still means “do nothing”) to skip the probe.

**Migration.** Existing callers continue to work without modification — this
is a purely additive change. New code can drop the manual composition:

```ts
// Before — manual composition of universals + detected agents
const universal = getUniversalAgents();
const additional = await detectInstalledAgents();
await generateSkill({
  command,
  meta,
  agents: [...universal, ...additional],
  scope: "global",
});

// After — same result, no manual composition
await generateSkill({ command, meta, scope: "global" });
```

`getUniversalAgents()` and `detectInstalledAgents()` remain exported for
callers who want fine-grained control.
