# @crustjs/testing

Typed terminal testing helpers for Crust CLI applications.

Use core `app.run(path, input)` for quiet captured output and typed completed/finished/failed outcomes. `captureExecute(app, argv)` tests terminal parsing, error presentation, and exit codes. `runInteractive(app, path, input)` drives fake-terminal prompts and propagates failed outcomes through `done` and `waitFor`.

## Install

```sh
bun add -d @crustjs/testing
```

## Documentation

Full docs: [crustjs.com/docs/modules/testing](https://crustjs.com/docs/modules/testing)
