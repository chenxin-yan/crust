import type { AnsiPair } from "./ansiCodes.ts";
import * as codes from "./ansiCodes.ts";

function readStyleMethodPairs(): Omit<typeof codes, "reset"> {
	const { reset: _reset, ...pairs } = codes;
	void _reset;
	return pairs;
}

const styleMethodPairs: Omit<typeof codes, "reset"> = Object.freeze(
	readStyleMethodPairs(),
);

export type StyleMethodName = keyof typeof styleMethodPairs;

export const styleMethodNames: readonly StyleMethodName[] = Object.freeze(
	Object.keys(styleMethodPairs) as StyleMethodName[],
);

export function stylePairFor(name: StyleMethodName): AnsiPair {
	return styleMethodPairs[name];
}
