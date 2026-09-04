import { BUN_TARGETS, hostTarget as resolveHostTarget } from "../src/utils/build-helpers.ts";

export function hostTarget() {
	return resolveHostTarget(BUN_TARGETS);
}
