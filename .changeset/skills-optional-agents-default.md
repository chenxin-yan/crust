---
"@crustjs/skills": patch
---

# Make `agents` optional on `generateSkill`, `uninstallSkill`, and `skillStatus`

The `agents` field on `GenerateOptions`, `UninstallOptions`, and
`StatusOptions` is now optional. The default differs by entrypoint so
install behavior tracks the current machine, while uninstall and status
sweep every known path:

| Entrypoint                      | Default when `agents` is omitted                          | `PATH` I/O? |
| ------------------------------- | --------------------------------------------------------- | ----------- |
| `generateSkill`                 | `[...getUniversalAgents(), ...await detectInstalledAgents()]` | Yes      |
| `uninstallSkill`, `skillStatus` | Every supported agent (exhaustive sweep of all known paths)   | No       |

In all three, `agents: []` is treated as a no-op (no install, uninstall, or
status entries). An explicit array always overrides the default.

**Behavior change.** Existing callers that pass an explicit `agents` array
keep their current behavior. Callers that omit `agents` (or pass
`agents: undefined`, which is common from object spread) now trigger the
defaults above:

- `generateSkill` performs filesystem I/O via `detectInstalledAgents()` to
  probe `PATH` for installed agent CLIs.
- `uninstallSkill` and `skillStatus` do not probe `PATH`; they iterate the
  full agent registry and stat each per-agent path, which can return a
  larger result set than before (one entry per supported agent).

**Migration.**

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

`getUniversalAgents()`, `getAdditionalAgents()`, and
`detectInstalledAgents()` remain exported for callers who want fine-grained
control.

**Bug fix.** `detectInstalledAgents()` no longer reports a command as
installed when the matching `PATH` entry is an executable directory rather
than a file. The probe now requires the entry to be a regular file (or
symlink to one) before checking the `X_OK` bit.
