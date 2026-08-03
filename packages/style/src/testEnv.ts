// ────────────────────────────────────────────────────────────────────────────
// Test-only env helpers — shared by co-located tests, not part of the build
// (nothing under `index.ts` imports this file).
// ────────────────────────────────────────────────────────────────────────────

/** Set or delete an environment variable (`undefined` deletes). */
export function setEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

/**
 * Snapshot the named environment variables and return a restore function.
 *
 * @example
 * ```ts
 * const restore = snapshotEnv("FORCE_COLOR", "NO_COLOR");
 * beforeAll(() => setEnv("FORCE_COLOR", "3"));
 * afterAll(restore);
 * ```
 */
export function snapshotEnv(...names: string[]): () => void {
	const saved = names.map((name) => [name, process.env[name]] as const);
	return () => {
		for (const [name, value] of saved) {
			setEnv(name, value);
		}
	};
}
