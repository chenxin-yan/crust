# Research progress: CLI alias APIs

- [x] commander.js
- [x] oclif
- [x] clipanion
- [x] cac
- [x] yargs
- [x] citty (unjs)
- [x] Cobra (Go)
- [x] Synthesis + recommendation

Output: research-aliases.md

## Scout: Command & Subcommand Alias Support

**Date:** 2026-05-03

- [x] Mapped command definition API (`CommandMeta`, `Crust` builder)
- [x] Located subcommand registry (`CommandNode.subCommands` Record)
- [x] Identified command resolution entry point (`resolveCommand()` in router.ts)
- [x] Checked help/autocomplete/completion plugin enumeration
- [x] Reviewed prior task packets (TP-008, TP-009, TP-010)
- [x] Analyzed collision detection patterns (flags)
- [x] Identified all extension points and test locations

Output: scout-aliases.md

**Key Findings:**
- No alias field on `CommandMeta` yet
- Resolution is exact string match: `if (candidate in subCommands)`
- Collision detection exists for duplicate command names (at registration) and flag aliases (at parse time)
- Help/error reporting enumerates via `Object.keys(subCommands)` — canonical names only
- TP-009 provides pattern for metadata-driven filtering (`hidden` field); TP-010 will implement tree walker for completion
- 9 open design questions identified; all require decision before implementation
- Comprehensive test coverage exists for resolution and builder; alias tests should extend `router.test.ts` and `crust.test.ts`
