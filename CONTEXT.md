# Crust

A Bun-first TypeScript CLI framework: a core command runtime plus opt-in packages for terminal interaction (prompts, progress, style, TUI).

## Language

**TUI**:
A full-screen interactive application, rendered by OpenTUI, that a command action launches and that owns the terminal until it exits. Distinct from prompts and progress, which are inline interactions written into the command's normal output stream.
_Avoid_: Screen, app, interactive mode

**TUI adapter**:
The `@crustjs/tui` package: it bridges a command action to an OpenTUI renderer (TTY gating, renderer lifecycle, teardown) and nothing more. It is not an Extension and adds no components, routing, or state.
_Avoid_: TUI framework, TUI extension
