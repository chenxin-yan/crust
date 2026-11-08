/** `CI` counts as set unless it is empty, `0`, or `false` in any letter case. */
export function isCI(): boolean {
	const ci = process.env.CI;
	return !!ci && ci !== "0" && ci.toLowerCase() !== "false";
}
