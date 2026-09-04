# @crustjs/prompts

Interactive terminal prompts for the Crust CLI ecosystem.

## Install

```sh
bun add @crustjs/prompts
```

## Custom prompts

The package root exports the built-in rendering pieces, including `renderTextWithCursor`, `highlightMatches`, `formatPromptLine`, `formatSubmitted`, `renderChoiceList`, and the shared prompt glyph constants.

Test prompts through `@crustjs/prompts/testing`: call `prompt.type(text)` for literal text and `prompt.keys(...keys)` for named or control keys. Use `withTerminalIO()` to route prompts and `@crustjs/progress` indicators through one ambient input/output scope; `withPromptIO()` remains an alias.

## Documentation

Full docs: [crustjs.com/docs/modules/prompts](https://crustjs.com/docs/modules/prompts)
