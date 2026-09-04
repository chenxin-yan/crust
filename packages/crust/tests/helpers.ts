import { SUPPORTED_TARGETS, TARGET_INFO, type BunTarget } from "../src/utils/build-helpers.ts";

export function hostTarget(): BunTarget | null {
	const platformKey = `${process.platform}-${process.arch}`;
	return (
		SUPPORTED_TARGETS.find((target) => TARGET_INFO[target].platformKey === platformKey) ?? null
	);
}
