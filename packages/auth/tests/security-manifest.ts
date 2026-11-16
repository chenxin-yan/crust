// The applicability manifest: every checklist item and decision of the auth security checklist
// (auth-security.md revision 7, §5), its owning stage and its v1 state. check-security.ts
// requires an executed, passed test naming each id (`SEC-<id>`) that a gated stage owns, and
// each deferred id's v1-invariant test. Later stages add themselves to GATED_OWNERS.

export type SecurityState = "applicable" | "deferred" | "inapplicable";

export interface SecurityRow {
	/** Ids as written in §5: `A1–A9`, `M1, M2`, `DEC-04–DEC-06`. */
	ids: string;
	owners: readonly string[];
	state: SecurityState;
	note?: string;
}

/** §5, row by row. */
export const MANIFEST_ROWS: readonly SecurityRow[] = [
	{ ids: "A1–A9", owners: ["AU1"], state: "applicable" },
	{ ids: "B1–B7", owners: ["AU1"], state: "applicable" },
	{ ids: "C1–C16", owners: ["AU1"], state: "applicable" },
	{ ids: "D1–D11", owners: ["AU1"], state: "applicable" },
	{ ids: "E1–E8", owners: ["AU1"], state: "applicable", note: "E8 also gated in AU2" },
	{ ids: "F1–F9", owners: ["AU2"], state: "applicable" },
	{ ids: "G1–G5", owners: ["AU2"], state: "applicable" },
	{ ids: "H1–H8", owners: ["AU1"], state: "applicable" },
	{ ids: "I1–I4", owners: ["AU1"], state: "applicable" },
	{
		ids: "I5",
		owners: ["AU1"],
		state: "inapplicable",
		note: "code-only flow; ID tokens ignored (DEC-12); its test checks id_token is never read",
	},
	{
		ids: "I6",
		owners: ["AU1", "AU3"],
		state: "applicable",
		note: "AU1 config validation; AU3 profile creation",
	},
	{ ids: "I7", owners: ["AU1"], state: "applicable", note: "AU3 profiles feed the server set" },
	{ ids: "J1–J7", owners: ["AU2"], state: "applicable" },
	{
		ids: "J8",
		owners: ["S2", "AU2"],
		state: "applicable",
		note: "S2 owns lazy auth() and auth: false (tests in packages/openapi); AU2 owns the dry-run zero-I/O test",
	},
	{
		ids: "K1–K6",
		owners: ["AU1"],
		state: "applicable",
		note: "sentinel gate extended by AU2 and AU3",
	},
	{ ids: "L1–L5", owners: ["AU1"], state: "applicable" },
	{ ids: "M1, M2", owners: ["#675", "AU2"], state: "applicable" },
	{ ids: "M3, M4", owners: ["AU2", "#675"], state: "applicable" },
	{ ids: "M5", owners: ["#675", "AU2"], state: "applicable" },
	{ ids: "M6–M12", owners: ["AU3"], state: "applicable" },
	{ ids: "N1, N2, N4–N6", owners: ["AU2"], state: "applicable" },
	{
		ids: "N3",
		owners: ["AU2"],
		state: "applicable",
		note: "includes readStdin maxBytes in @crustjs/utils",
	},
	{
		ids: "O1–O4",
		owners: ["AU1"],
		state: "applicable",
		note: "rules govern AU2/AU3 operations too",
	},
	{
		ids: "P1, P3",
		owners: ["AU1"],
		state: "applicable",
		note: "P1 extended to AU2/AU3 operations",
	},
	{ ids: "P2, P4", owners: ["AU2"], state: "applicable" },
	{ ids: "Q1, Q2, Q5", owners: ["AU2"], state: "applicable" },
	{ ids: "Q3", owners: ["#675", "AU2"], state: "applicable" },
	{ ids: "Q4", owners: ["#675", "AU2"], state: "applicable" },
	{ ids: "DEC-01, DEC-02", owners: ["AU1"], state: "applicable" },
	{ ids: "DEC-03", owners: ["AU1"], state: "applicable" },
	{ ids: "DEC-04–DEC-06", owners: ["AU1"], state: "applicable" },
	{ ids: "DEC-07", owners: ["AU1", "AU2", "AU3"], state: "applicable" },
	{ ids: "DEC-08", owners: ["AU1"], state: "applicable" },
	{ ids: "DEC-09", owners: ["AU1"], state: "applicable" },
	{ ids: "DEC-10", owners: ["AU2"], state: "applicable" },
	{
		ids: "DEC-11",
		owners: ["AU1"],
		state: "applicable",
		note: "E7 plus the docs statement in modules/auth",
	},
	{
		ids: "DEC-12",
		owners: [],
		state: "deferred",
		note: "ID tokens out of v1; invariant: id_token ignored (E3, K1)",
	},
	{ ids: "DEC-13", owners: ["#675", "AU2"], state: "applicable" },
	{ ids: "DEC-14–DEC-16", owners: ["AU1"], state: "applicable" },
	{ ids: "DEC-17", owners: ["AU1", "AU2", "AU3"], state: "applicable" },
	{
		ids: "DEC-18",
		owners: [],
		state: "deferred",
		note: "DPoP out of v1; invariant: non-bearer rejected (E3)",
	},
	{ ids: "DEC-19", owners: ["AU2"], state: "applicable" },
	{
		ids: "DEC-20",
		owners: [],
		state: "deferred",
		note: "nonce out of v1; invariant: nonce never sent (B1)",
	},
];

/** Stages whose ids the executed-results gate requires. */
export const GATED_OWNERS: readonly string[] = ["AU1"];

/**
 * Checks no test run can prove, recorded with their platform: real-runtime conformance and
 * manual checks.
 */
export const PLATFORM_NOTES: Readonly<Record<string, string>> = {
	C14: "Also runs on spawned Node and Bun with real timers (tests/runtimes.test.ts, Linux, macOS and Windows CI)",
	C15: "Also runs on spawned Node and Bun (tests/runtimes.test.ts, Linux, macOS and Windows CI)",
	E6: "Also runs on spawned Node and Bun against a second listener (tests/runtimes.test.ts)",
	C5: "Node and Bun expose no SO_EXCLUSIVEADDRUSE; the default bind (no reusePort) refuses a second listener",
	L2: "The argv test runs in the Windows CI job; a real browser launch through rundll32 is a manual check on a Windows host",
};

export interface SecurityItem {
	id: string;
	owners: readonly string[];
	state: SecurityState;
	note: string | undefined;
}

/** Expands `A1–A9`, `N1, N2, N4–N6` or `DEC-04–DEC-06` into single ids. */
export function expandIds(ids: string): string[] {
	return ids.split(", ").flatMap((part) => {
		const [first, last] = part.split("–");
		if (last === undefined) return [first!];
		const prefix = first!.replace(/\d+$/, "");
		const width = first!.length - prefix.length;
		const from = Number(first!.slice(prefix.length));
		const to = Number(last.slice(prefix.length));
		return Array.from(
			{ length: to - from + 1 },
			(_, index) => `${prefix}${String(from + index).padStart(width, "0")}`,
		);
	});
}

export const SECURITY_MANIFEST: readonly SecurityItem[] = MANIFEST_ROWS.flatMap((row) =>
	expandIds(row.ids).map((id) => ({ id, owners: row.owners, state: row.state, note: row.note })),
);

/** Ids that need an executed, passed test: those a gated stage owns, and every deferred id. */
export function requiredIds(): string[] {
	return SECURITY_MANIFEST.filter(
		(item) =>
			item.state === "deferred" || item.owners.some((owner) => GATED_OWNERS.includes(owner)),
	).map((item) => item.id);
}
