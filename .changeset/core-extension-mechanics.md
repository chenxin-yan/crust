---
"@crustjs/core": minor
---

Packages can own keys on definitions, Extensions can bind text as the command line converts it, and an action can run another command of its app. See [Own a definition key](https://crustjs.com/docs/guide/extensions#own-a-definition-key) and [Bind values](https://crustjs.com/docs/guide/extensions#bind-values). **Breaking:** `bindInput` calls add up instead of re-binding against the original input.

- New exported interfaces `ArgExtras`, `FlagExtras`, and `CommandExtras`, which argument definitions, flag definitions, and command metadata extend, as do `ArgSnapshot`, `FlagSnapshot`, and `CommandSnapshot.meta`. A package adds an optional key with `declare module "@crustjs/core" { interface FlagExtras { hint?: string } }`; the key is typed in every file of the app once any file imports the package, and stays an unknown-key compile error without it. Snapshots pass such keys through unchanged, so the Extension reads them typed.
- New `.owns(...keys)` on `defineExtension()`: the keys the Extension owns. It refuses `toJSON`, `inputSchema`, and `extension` with a `DEFINITION` error (`reserved-name`). A definition that sets a key no installed Extension owns is a `DEFINITION` error (`unowned-key`) from source and in `crust build`.
- New `ctx.bindText({ args, flags })` on the Extension context: binds text, such as a prompt's answer, converted exactly as the same word on the command line (`type`, `choices`, a custom `parse`, a repeatable flag's `delimiter`), and a bad value throws the command line's own `PARSE` error. `bindInput` stays for typed values.
- **Breaking:** `bindInput` and `bindText` calls add to earlier bindings, so two Extensions that bind no longer undo each other: a key bound again takes the later value, and keys a call leaves out keep theirs. Before, each call re-bound against the original input and the last call won.
- New `runCommand(path, input?, options?)` on the action context: runs a command of the same app as `app.run()` does, as a fresh invocation with its own Contexts and captured output, cancelled with the caller unless given its own `signal`. It resolves to the `RunOutcome` and never throws.
