---
"@crustjs/config": minor
---

**Breaking:** settings now land in flags. `defineConfig({ name, settings, project?, files?, command? })` defines every setting once, as the definition of a string, number or boolean flag, and replaces `defineConfig({ name, global, project }).flags({...})`, `config.settings` (one Context per setting), `config.global` (the store of the global file), `global: true` and `flag: false`.

- A command takes a setting as a flag under any name with `config.flag("region")`. `.extend(config.extension)` binds the files' value into such a flag when the run gives none, so the action reads the final value from `flags`: the command line or input, then the flag's `env`, then the project file, then the user's file, then `default`. `--help` shows the flag's default, `required` is checked after the files, and `prompts()` does not ask for a value a file gave.
- `await config.get(key)` reads any setting, `await config.list()` returns every setting with its value and source, and `config.set(values)` or `config.set(values, { project: true })` saves them. Keys and values are checked at compile time, a value the setting's rules refuse throws before anything is saved, and saving in a linked project file is refused.
- The user's file (`config.json` in the app's configuration directory) is always read. `project: ["region"]` turns on the project file and lists the settings it may set: anything else a project file sets is ignored with a warning naming the key and both files, so a cloned repository can no longer set every setting.
- `files: { user, project, parse, stringify }` names the files and supplies a format other than JSON. A text value from a file is converted as the same text in an environment variable.
- `command: true` adds `config get`, `set`, `unset` and `list`; `set --project` refuses settings outside the project list.
