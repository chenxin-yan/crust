import { type SpinnerHandle, spinner } from "./spinner.ts";
import type { Equal, Expect } from "./test-helpers.ts";

// Compile-time regression checks; intentionally never invoked.
function _spinnerReturnTypeTests() {
	// A stored options object with a synchronous task runs the task, so it returns a Promise.
	const syncOptions = { message: "Working", task: () => 42 };
	const stored = spinner(syncOptions);
	type _StoredSyncTaskIsPromise = Expect<Equal<typeof stored, Promise<number>>>;

	const inlineSync = spinner({ message: "Working", task: () => "done" });
	type _InlineSyncTaskIsPromise = Expect<Equal<typeof inlineSync, Promise<string>>>;

	const inlineAsync = spinner({ message: "Working", task: async () => 42 });
	type _AsyncTaskUnwraps = Expect<Equal<typeof inlineAsync, Promise<number>>>;

	// Without a task, the imperative handle overload applies.
	const handleOptions = { message: "Working" };
	const handle = spinner(handleOptions);
	type _NoTaskIsHandle = Expect<Equal<typeof handle, SpinnerHandle>>;

	spinner({ message: "Working", signal: AbortSignal.timeout(1000) });
	// @ts-expect-error — `signal` takes an AbortSignal
	void spinner({ message: "Working", signal: true });
}
