import type { ProgressSink } from "./spinner.ts";

export interface FakeSink {
	sink: ProgressSink;
	writes: string[];
}

export function createFakeSink(isTTY = true): FakeSink {
	const writes: string[] = [];
	return { sink: { isTTY, write: (text) => writes.push(text) }, writes };
}
