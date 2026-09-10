# @crustjs/core

Core library for the Crust CLI framework.

Typed `run(path, { args, flags, raw })` binds structured values directly to the selected command; only the path selects subcommands. Known inputs stay strict while observable constraints are checked automatically. `run()` is quiet and returns captured `stdout`/`stderr` with `completed`/`finished`/`failed` status; inspect failures explicitly. JSON values retain identity. Optional IO callbacks forward live output while retaining capture. Use `execute({ argv })` for streaming terminal output, argument parsing, error presentation, and exit codes.

## Install

```sh
bun add @crustjs/core
```

## Documentation

Full docs: [crustjs.com/docs/modules/core](https://crustjs.com/docs/modules/core)
