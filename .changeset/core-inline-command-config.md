---
"@crustjs/core": patch
---

Inline commands take the same config as `defineCommand()`: `.command(name, { description, aliases, hidden, usage, sections }, recipe)`. Help, `--llms`, skills, and completions now list a description for inline commands, and their aliases route and are checked against sibling names like those of added definitions.

An inline `.command()` child's action now types the Context-owned flags it parses: those of the Contexts its parent declares with `.use()` or `.provide()` before the call. Before, `flags.home` was a type error although `--home` was parsed.

A group command no longer has to `.use()` the Contexts of the commands it adds. A definition demands its own `.use()` Contexts plus its children's demands that it doesn't provide itself, and TypeScript checks them where the group is added, as for any command. The group doesn't parse those Contexts' flags; they stay on the commands that use them. A demand that nothing provides now names the command and the fix: `Context "config" used by "version" is not provided: .provide() it on an ancestor`.
