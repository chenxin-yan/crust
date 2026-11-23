---
"@crustjs/core": minor
"@crustjs/utils": minor
---

A failed write to stdout now throws from `stdout()` instead of vanishing, and `signal.reason.cause` names what cancelled a run. **Breaking:** `app > /dev/full` exits 1, and `app | head` exits 141 for the writer.

- When the reader of stdout goes away (`app | head -1`), `stdout()` throws an `AbortError` and aborts the invocation's `signal` with it. Nothing prints, and the run exits 141 (128 + `SIGPIPE`) whatever the action did, so a streaming action that watches `signal` stops instead of running on. Under `set -o pipefail` the pipeline reports 141, as it does for `yes | head -1`.
- Any other failed write to stdout, such as `ENOSPC` on a full disk, throws the system error: the run fails with `Error: ENOSPC: no space left on device, write` and exit 1, as `ls` and `jq` do. Before, the write was dropped and the run exited 0.
- A failed write to stderr is still ignored.
- `signal.reason.cause` is `"SIGINT"`, `"SIGTERM"`, or `"SIGPIPE"`, so code that forwards the signal to a child no longer reads the English message.
- This applies to the default output on macOS and Linux; Windows keeps the stream writer, which never throws.

```ts
await new Crust("follow")
	.action(async ({ stdout, signal }) => {
		for (let n = 0; !signal.aborted; n++) {
			stdout(`line ${n}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	})
	.execute();
// `follow | head -1`: before, printed `line 0` and hung until killed; now it ends at once with 141.
```
