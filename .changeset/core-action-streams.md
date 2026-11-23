---
"@crustjs/core": minor
"@crustjs/testing": minor
"@crustjs/extensions": patch
"@crustjs/openapi": patch
---

The action's `stdout` and `stderr` can write raw text and bytes and say whether they are a terminal, and a new `stdin` reads input that Ctrl+C can cancel. Context setups and Extension hooks receive the same streams. See the new [Terminal I/O](https://crustjs.com/docs/guide/terminal-io) guide. **Breaking:** the `execute({ io })` streams, the `run()` output callbacks, and a Renderer's `text` and `diag` receive each write as it was made, newline included.

- `stdout(text)` and `stderr(text)` still write a line. `stdout.write(chunk)` writes text or a `Uint8Array` as it is, adding no newline, so `ls -0`-style output, binary data, and partial lines no longer need a private writer. A failed `stdout.write()` throws like `stdout()`: a closed reader cancels the run with exit code 141, and any other write error fails it with exit code 1.
- `stdout.isTTY`, `stdout.columns`, `stderr.isTTY`, and `stderr.columns` describe the invocation's stream: the process's under `execute()`, never a terminal under `run()`, and what a test sets under `captureExecute()`. `columns` is `undefined` when the stream has no width, such as a pipe.
- `stdin.text()` resolves to the rest of stdin, and `stdin.stream()` yields it chunk by chunk. Both stop with the invocation's cancellation, so the first Ctrl+C ends a run waiting on stdin. Each read continues where the last one stopped, and a read started while another is unfinished throws. `stdin.isTTY` says whether stdin is a terminal.
- `execute({ io })` takes `stdout` and `stderr` objects with a `write(chunk)` method and optional `isTTY` and `columns`, such as a Node.js writable stream, instead of line callbacks, and a `stdin` async iterable. `run()`'s `stdout` and `stderr` callbacks receive each chunk as written: `stdout("a")` arrives as `"a\n"`. A Renderer's `text` and `diag` receive the same chunks; pass them on with `ctx.stdout.write`, not `ctx.stdout`. Core exports the `OutputStream`, `InputStream`, and `OutputSink` types.
- `captureExecute(app, argv, options)` takes `stdin` (the text the action reads), `isTTY: true` (the streams report a terminal), and `columns` (its width, default 80). Without them, stdin is empty and nothing is a terminal. The unused `CaptureIO` type is removed.
- `jsonInput()`'s `--input -` and `@crustjs/openapi`'s `--body -` read the invocation's `stdin`.
- `updateNotifier()` checks whether the invocation's `stderr` is a terminal, where it writes its notice, instead of `process.stderr`; under `run()` it never checks.
- `@crustjs/openapi`'s `api <path>` writes a body's bytes through `stdout.write()`, so an `execute({ io })` sink receives them as a pipe does, and `run()` and `captureExecute()` capture them decoded as UTF-8 instead of refusing a binary body, and decides whether stdout is a terminal from the invocation's `stdout`.

```ts
await new Crust("upper")
	.action(async ({ stdin, stdout }) => {
		if (stdin.isTTY) throw new Error("Pipe text to stdin.");
		stdout.write((await stdin.text()).toUpperCase());
	})
	.execute();
```
