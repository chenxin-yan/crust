import type { TerminalOutput } from "./spinner.ts";

export interface FakeSink {
	sink: TerminalOutput;
	writes: string[];
}

export function createFakeSink(isTTY = true): FakeSink {
	const writes: string[] = [];
	return { sink: { isTTY, write: (text) => writes.push(text) }, writes };
}

export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export type Expect<T extends true> = T;
