---
"@crustjs/plugins": minor
---

Add `completionPlugin` for shell tab-completion.

The new plugin registers a `completion <shell>` subcommand on the root command
that emits a self-contained tab-completion script for **bash**, **zsh**, or
**fish**. The strategy is **pure-static**: the plugin walks the live command
tree at run time and prints a fully-baked script. There are no runtime
callbacks, no hidden `__complete` subcommand, and no shell-out on TAB — the
generated script is the artifact users install into their shell.

```ts
import { Crust } from "@crustjs/core";
import { completionPlugin } from "@crustjs/plugins";

new Crust("my-cli")
  .use(completionPlugin({ version: "1.0.0" }))
  .command("build", (cmd) =>
    cmd.flags({
      target: { type: "string", choices: ["browser", "bun", "node"] },
    }).run(() => {}),
  )
  .run(() => {});
```

```sh
# Print to stdout — pipe into the shell's auto-discovery directory.
my-cli completion bash > ~/.local/share/bash-completion/completions/my-cli

# Or generate every supported shell at packaging time.
my-cli completion bash --output-dir completions/
# → completions/my-cli, completions/_my-cli, completions/my-cli.fish
```

Highlights:

- **All three shells from one walk.** The bash template ships a Cobra-style
  init shim so it works on systems without the `bash-completion` package
  (macOS default bash, Alpine, NixOS without the package). The zsh template
  uses `_arguments -C` with `->state` subcommand routing and emits
  description-rich menus. The fish template emits declarative `complete -c`
  rules with chained `__fish_seen_subcommand_from` predicates.
- **Choices and aliases surface end-to-end.** Static enums declared via
  the `choices` field on `FlagDef`/`ArgDef` become value lists in the
  generated scripts. Command aliases (`meta.aliases`) are tab-completable
  and resolve to the canonical command's flags.
- **`--output-dir` for distributors.** Writes all configured shells with
  the canonical filenames Homebrew, Nix, AUR, and Debian expect
  (`<bin>` for bash, `_<bin>` for zsh, `<bin>.fish` for fish) — no rename
  needed. Use the `shells` option to scope down.
- **Drift is mitigated by versioned headers.** Each generated script's
  first line embeds the binary name and version, so users (and `diff`)
  spot stale completion files at a glance, with the regenerate command
  inline.

Limitations (v1):

- No dynamic value completion (per-flag/per-arg `complete?:` callbacks);
  intentionally deferred to a future minor bump. Adding them is
  non-breaking, so v1 ships pure-static today and grows into a hybrid later.
- No PowerShell template (planned for v2).
