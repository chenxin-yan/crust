# Defaults for variadic positional arguments

## Conclusion

There is no universal convention for the shape of an omitted variadic argument's default. The common behavior in ordinary parsing is **fallback, not accumulation**: explicitly supplied arguments replace the default. Custom reducers can deliberately behave differently.

Crust already accepts scalar positional defaults and promises an array for variadic results. The approved fix therefore keeps that API:

| Input                  | Result for `variadic: true, default: "fallback"` |
| ---------------------- | ------------------------------------------------ |
| Omitted                | `["fallback"]`                                   |
| `a b`                  | `["a", "b"]`                                     |
| Structured empty array | `["fallback"]`                                   |

Without a default, omission remains `[]`. Required variadics without defaults still need at least one value. A declared default continues to satisfy Crust's existing required/default rule.

This is a deliberate Crust contract, **not a claim that other frameworks wrap scalar defaults automatically**. It is proposed by the separate core fix; adding this research note does not mean that fix has shipped.

## Primary-source comparison

| Framework/version         | Omitted optional variadic                                                                                     | Supplied values                                                                                                      | Required/default interaction                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Commander.js 14.0.3       | `[]` without a default; otherwise preserves the declared default, including a scalar                          | Replace the fallback with an array without a custom parser; custom parsers receive the default as their reducer seed | Required arguments still need a token; required + default without a custom parser is rejected |
| yargs 18.0.0              | `[]` by default; array defaults are demonstrated in its tests                                                 | Explicit regression test confirms replacement, not concatenation                                                     | Required variadics check actual positional count                                              |
| Click 8.3.1               | `()` without a default; iterable defaults are converted to tuples; a scalar string default is rejected        | Replace the fallback                                                                                                 | A nonempty converted default can satisfy `required=True`; an empty tuple cannot               |
| argparse / CPython 3.14.0 | For `nargs="*"`, `[]` without a non-`None` default; otherwise preserves the default's scalar/list/tuple shape | Newly converted list replaces the fallback                                                                           | `nargs="+"` requires an actual token despite a default                                        |

### Commander.js

The [argument docs](https://github.com/tj/commander.js/blob/v14.0.3/Readme.md#command-arguments) describe variadic arguments and optional defaults. In [`_processArguments`](https://github.com/tj/commander.js/blob/v14.0.3/lib/command.js), the result starts as `declaredArg.defaultValue`. Supplied variadic tokens replace it; only an absent `undefined` default becomes `[]`. Defaults themselves do not pass through the argument parser.

Custom parsers are a qualification: supplied tokens reduce from the declared default. [`Argument.choices` and `_collectValue`](https://github.com/tj/commander.js/blob/v14.0.3/lib/argument.js) start a fresh collection instead of appending to the fallback. `addArgument` and `_checkNumberOfArguments` establish the required-argument behavior.

### yargs

The [advanced docs](https://github.com/yargs/yargs/blob/v18.0.0/docs/advanced.md#variadic-positional-arguments) describe array-valued variadic positionals. The versioned [command tests](https://github.com/yargs/yargs/blob/v18.0.0/test/command.mjs), under “does not combine positional default and provided values,” use `default: ['pizza', 'wings']` and assert that supplied fruit names replace it.

[`lib/command.ts`](https://github.com/yargs/yargs/blob/v18.0.0/lib/command.ts) supplies array hints and an implicit empty default, while allowing explicit defaults to override them. This research does not establish the output shape of an explicitly supplied **scalar** variadic default or every default/coercion combination.

### Click

The [argument docs](https://click.palletsprojects.com/en/stable/arguments/#multiple-arguments) describe `nargs=-1` tuple results. The versioned [parser](https://github.com/pallets/click/blob/8.3.1/src/click/parser.py) marks an empty positional tuple as unset, allowing fallback resolution.

In [8.3.1 `core.py`](https://github.com/pallets/click/blob/8.3.1/src/click/core.py), `consume_value` resolves the default, `type_cast_value` converts each iterable element, and `process_value` checks requiredness afterwards. `_check_iter` rejects a scalar string: use an iterable such as `('fallback',)`. [Choice conversion](https://github.com/pallets/click/blob/8.3.1/src/click/types.py) also applies to default elements.

### argparse

The [3.14 docs](https://docs.python.org/3.14/library/argparse.html#nargs) distinguish `*` from `+`. In [CPython 3.14.0 `_get_values`](https://github.com/python/cpython/blob/v3.14.0/Lib/argparse.py), the zero-token positional `*` branch returns a non-`None` default unchanged. It does not perform the normal supplied-element conversion or choices check in that branch. Do not generalize argparse's ordinary string-default conversion rule to this special case.

## Fit with Crust

The baseline inspected was `c4f44d6f`:

- [`ArgDef` and `InferArgValue`](../packages/core/src/types.ts) already allow scalar defaults and preserve array-valued variadic output.
- [`resolveArgs` and `resolveDefault`](../packages/core/src/parsing/parser.ts) are shared by argv and structured invocation. The original variadic branch skipped default resolution entirely.
- Reusing `resolveDefault` retains existing custom parsing and path resolution. JSON/URL defaults are already resolved values.
- String choices/default compatibility is checked during [definition normalization](../packages/core/src/parsing/spellings.ts), not newly during omission. The fix should not introduce different validation rules for scalar and variadic defaults.
- Repeated flags have a separate array-default authoring API; this fix does not change it or introduce array-default shorthand for string positionals.

The approved implementation preserves those choices rather than copying another framework's shape-changing default behavior.

## Evidence limits

The comparison is based on official documentation, versioned implementation, and published tests. Third-party frameworks were not executed as a cross-framework runtime matrix. Stable Click documentation may advance; the behavior described above is anchored to 8.3.1 source. The yargs scalar-default case remains explicitly unverified.

Core regression tests cover the actual Crust change separately, including both invocation paths, omission/replacement, an explicit empty array, parsed defaults, a zero default, path defaults, and required-with-default behavior.
