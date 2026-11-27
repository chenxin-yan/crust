---
"@crustjs/core": minor
---

Each Extension hook has one job, so the `.extend()` order of Extensions rarely matters.

- New `.defaults(fn)` hook for values from somewhere other than the run, such as a config file or the last run. It returns `{ args?, flags? }` by name, as text typed on the command line (a number or boolean is taken as its text). It runs only when the Command Action will, after every `setup` and before every `preRun`, also under typed `run()` and MCP. Core keeps only the names the command takes that have no value yet or only their default, so the command line, an environment variable, typed `run()` input, anything bound in `setup`, and an Extension listed earlier all win; a dropped value is never converted. The rest is converted as `bindText` converts it and reports `bound`. The `ExtensionDefaults` type names what it returns.
- **Breaking:** `onError` returns the function that prints the failure instead of `true`. Core calls every Extension's `onError` first, so each sees the failure and may add to it, then calls the first function returned; that Extension is the outcome's `by`. When the returned function throws, the failure renders as if no hook had printed it.
- `preRun` may return a function, which runs once every `preRun` returned without throwing, in `.extend()` order and before validation. Asking a question this way lets every check refuse the run before anything is asked.
- During `crust build`, every build hook receives the same snapshot, taken before the first one runs; section callbacks are no longer evaluated again after each hook.

See [Hooks](https://crustjs.com/docs/guide/extensions#hooks).
