---
"@crustjs/plugins": minor
"@crustjs/man": minor
"@crustjs/core": patch
---

Make the `choices`, `meta.aliases`, and `meta.hidden` contracts consistent
across every consumer (help, did-you-mean, man, completion).

A cross-consumer audit found three gaps:

- `helpPlugin` rendered output omitted the `choices` list for both flags
  and positional args, so users could not discover valid values from
  `--help` without resorting to shell completion or source-reading.
- `didYouMeanPlugin` and the `@crustjs/man` manpage generator both
  walked the command tree without filtering `meta.hidden: true`, so
  internal commands (e.g. `__complete`) leaked into typo suggestions,
  the "Available commands" fallback, and published man pages.
- `@crustjs/man` omitted long flag aliases (`def.aliases`) and `choices`
  from the OPTIONS / ARGUMENTS sections, leaving the man page strictly
  less informative than `--help`.
- The completion plugin's bash and fish templates only surfaced
  `choices` for the **first** positional argument; zsh respected every
  slot. Variadic-with-choices arguments and multi-positional commands
  silently fell through to file completion in bash/fish.

Changes:

- `helpPlugin` renders `[choices: a, b, c]` after the description for
  every flag and arg that declares a `choices` list, composed with
  `[default: ...]` when both are present.
- `didYouMeanPlugin` skips `meta.hidden: true` siblings in both the
  Levenshtein suggestion corpus (canonical names **and** aliases) and
  the "Available commands" fallback list.
- `@crustjs/man` filters `meta.hidden: true` subcommands from the
  SUBCOMMANDS section (and skips the section entirely when every
  subcommand is hidden), surfaces flag and arg `choices` as a
  `[choices: ...]` suffix, and includes long flag aliases in OPTIONS
  labels (`-o, --output, --out`, plus `--no-` negation for every long
  spelling on boolean flags).
- `completionPlugin` bash and fish templates now track positional slot
  index past the resolved command path and emit per-slot choice
  candidates. Variadic-with-choices arguments are handled correctly
  (the choice list applies at every slot from the variadic's declared
  index onwards). The fish template gains a second per-script helper
  `__<ident>_path_at_arg` that the existing `__<ident>_path_is` is
  layered alongside; subcommand and flag rules continue to use the
  original predicate.

Core / docs:

- `CommandMeta.hidden` JSDoc now enumerates every tooling surface the
  flag affects (help, completion, did-you-mean, man, skills) and is
  explicit that there is intentionally no analogous `FlagDef.hidden` —
  the workaround for flag-level hiding is to register without a
  description.
