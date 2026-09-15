import {
	BUN_TARGETS,
	DENO_TARGETS,
	hostTarget as resolveHostTarget,
} from "../src/utils/build-helpers.ts";

export function hostTarget() {
	return resolveHostTarget(BUN_TARGETS);
}

export function hostDenoTarget() {
	return resolveHostTarget(DENO_TARGETS);
}
