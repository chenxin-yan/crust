import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { valid, workload } from "./cases.ts";
import type { Invoke } from "./contract.ts";

const [mode, entry, countText = "1"] = process.argv.slice(2);
if (!entry) throw new Error("Missing entry");
const { invoke }: { invoke: Invoke } = await import(pathToFileURL(entry).href);
if (mode === "valid") {
	// Revisit defaults after every explicit invocation, across both command routes.
	for (let round = 0; round < 2; round++)
		for (const test of valid) {
			assert.deepEqual(await invoke([...test.argv]), test.expected, test.name);
			assert.deepEqual(await invoke([...valid[0].argv]), valid[0].expected, "fresh defaults");
		}
	console.log(JSON.stringify({ valid: valid.length * 4 }));
} else if (mode === "once") {
	try {
		console.log(JSON.stringify(await invoke(process.argv.slice(5))));
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
} else if (mode === "warm") {
	const count = Number(countText);
	if (!Number.isInteger(count) || count < 1 || count > 100_000) throw new Error("Invalid count");
	// Imports are outside timing; each adapter constructs its entire schema per call.
	// The same await and JSON consumption are deliberately included for sync and async APIs.
	const expected = JSON.stringify(workload.expected);
	const batches: number[] = [];
	const warmups = Number(process.argv[5]);
	const measurements = Number(process.argv[6]);
	if (![warmups, measurements].every((n) => Number.isInteger(n) && n > 0 && n <= 100))
		throw new Error("Invalid batches");
	for (let batch = 0; batch < warmups + measurements; batch++) {
		const start = performance.now();
		for (let i = 0; i < count; i++) {
			const result = await invoke([...workload.argv]);
			if (JSON.stringify(result) !== expected) throw new Error("Wrong warm result");
		}
		const ns = ((performance.now() - start) * 1e6) / count;
		if (batch >= warmups) batches.push(ns);
	}
	console.log(JSON.stringify({ nsPerInvocation: batches, callsPerBatch: count, warmups }));
} else throw new Error(`Unknown worker mode: ${mode}`);
