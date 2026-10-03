# @crustjs/testing

Test helpers for Crust CLIs with captured output and fake interactive terminals

Use core `app.run(path, input)` for quiet captured output and typed completed/handled/failed outcomes. `captureExecute(app, argv)` tests terminal parsing, error presentation, and exit codes. `runInteractive(app, path, input)` from `@crustjs/testing/interactive` drives fake-terminal prompts (requires `@crustjs/prompts`) and propagates failed outcomes through `done` and `waitFor`.

## Install

```sh
npm install -D @crustjs/testing
```

## Documentation

Full docs: [crustjs.com/docs/modules/testing](https://crustjs.com/docs/modules/testing)
