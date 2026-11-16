import { describe, expect, it } from "vite-plus/test";

import { checkReport } from "./check-security.ts";
import {
	expandIds,
	requiredIds,
	SECURITY_MANIFEST,
	type SecurityItem,
} from "./security-manifest.ts";

const range = (prefix: string, count: number, width = 1) =>
	Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(width, "0")}`);

/** Every checklist item and decision of revision 7. */
const CHECKLIST = [
	...range("A", 9),
	...range("B", 7),
	...range("C", 16),
	...range("D", 11),
	...range("E", 8),
	...range("F", 9),
	...range("G", 5),
	...range("H", 8),
	...range("I", 7),
	...range("J", 8),
	...range("K", 6),
	...range("L", 5),
	...range("M", 12),
	...range("N", 6),
	...range("O", 4),
	...range("P", 4),
	...range("Q", 5),
	...range("DEC-", 20, 2),
];

// auth-security.md revision 7, §5, columns Ids | Owner | State, copied as written. Kept apart
// from security-manifest.ts so a change to an owner or state there must be made here too.
const SECTION_5 = `
A1–A9 | AU1 | applicable
B1–B7 | AU1 | applicable
C1–C16 | AU1 | applicable
D1–D11 | AU1 | applicable
E1–E8 | AU1 | applicable
F1–F9 | AU2 | applicable
G1–G5 | AU2 | applicable
H1–H8 | AU1 | applicable
I1–I4 | AU1 | applicable
I5 | AU1 | inapplicable
I6 | AU1, AU3 | applicable
I7 | AU1 | applicable
J1–J7 | AU2 | applicable
J8 | S2, AU2 | applicable
K1–K6 | AU1 | applicable
L1–L5 | AU1 | applicable
M1, M2 | #675, AU2 | applicable
M3, M4 | AU2, #675 | applicable
M5 | #675, AU2 | applicable
M6–M12 | AU3 | applicable
N1, N2, N4–N6 | AU2 | applicable
N3 | AU2 | applicable
O1–O4 | AU1 | applicable
P1, P3 | AU1 | applicable
P2, P4 | AU2 | applicable
Q1, Q2, Q5 | AU2 | applicable
Q3 | #675, AU2 | applicable
Q4 | #675, AU2 | applicable
DEC-01, DEC-02 | AU1 | applicable
DEC-03 | AU1 | applicable
DEC-04–DEC-06 | AU1 | applicable
DEC-07 | AU1, AU2, AU3 | applicable
DEC-08 | AU1 | applicable
DEC-09 | AU1 | applicable
DEC-10 | AU2 | applicable
DEC-11 | AU1 | applicable
DEC-12 | — | deferred
DEC-13 | #675, AU2 | applicable
DEC-14–DEC-16 | AU1 | applicable
DEC-17 | AU1, AU2, AU3 | applicable
DEC-18 | — | deferred
DEC-19 | AU2 | applicable
DEC-20 | — | deferred
`;

/** §5 expanded per id, without the manifest's own range expansion. */
const SECTION_5_ITEMS = new Map(
	SECTION_5.trim()
		.split("\n")
		.flatMap((line) => {
			const [ids, owners, state] = line.split(" | ");
			const parsedOwners = owners === "—" ? [] : owners!.split(", ").sort();
			return ids!.split(", ").flatMap((part) => {
				const match = /^((?:DEC-)?[A-Q]?)(\d+)(?:–(?:DEC-)?[A-Q]?(\d+))?$/.exec(part)!;
				const [, prefix, from, to] = match;
				const width = prefix === "DEC-" ? 2 : 1;
				const ids: [string, { owners: string[]; state: string }][] = [];
				for (let n = Number(from); n <= Number(to ?? from); n += 1) {
					ids.push([
						`${prefix}${String(n).padStart(width, "0")}`,
						{ owners: parsedOwners, state: state! },
					]);
				}
				return ids;
			});
		}),
);

/** Ids whose owners or state differ from §5. */
function mismatches(manifest: readonly SecurityItem[]): string[] {
	const ids = new Set([...SECTION_5_ITEMS.keys(), ...manifest.map((item) => item.id)]);
	return [...ids].filter((id) => {
		const item = manifest.find((entry) => entry.id === id);
		const expected = SECTION_5_ITEMS.get(id);
		return (
			!item ||
			!expected ||
			item.state !== expected.state ||
			[...item.owners].sort().join() !== expected.owners.join()
		);
	});
}

const report = (tests: [string, string][]) => ({
	testResults: [{ assertionResults: tests.map(([fullName, status]) => ({ fullName, status })) }],
});

describe("security manifest", () => {
	it("lists every checklist id exactly once", () => {
		const ids = SECURITY_MANIFEST.map((item) => item.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect([...ids].sort()).toEqual([...CHECKLIST].sort());
	});

	it("matches the §5 owner and state of every id", () => {
		expect(SECTION_5_ITEMS.size).toBe(CHECKLIST.length);
		expect(mismatches(SECURITY_MANIFEST)).toEqual([]);
	});

	it("fails when an AU1 id is reassigned or its state changes", () => {
		const reassigned = SECURITY_MANIFEST.map((item) =>
			item.id === "A1" ? { ...item, owners: ["AU2"] } : item,
		);
		expect(mismatches(reassigned)).toEqual(["A1"]);
		const deferred = SECURITY_MANIFEST.map((item) =>
			item.id === "C9" ? { ...item, state: "deferred" as const } : item,
		);
		expect(mismatches(deferred)).toEqual(["C9"]);
		expect(mismatches(SECURITY_MANIFEST.filter((item) => item.id !== "K6"))).toEqual(["K6"]);
	});

	it("requires exactly the §5 ids AU1 owns plus the deferred invariants", () => {
		const expected = [...SECTION_5_ITEMS]
			.filter(([, item]) => item.owners.includes("AU1") || item.state === "deferred")
			.map(([id]) => id);
		expect([...requiredIds()].sort()).toEqual(expected.sort());
	});

	it("gives every deferred and inapplicable id its reason", () => {
		for (const item of SECURITY_MANIFEST) {
			expect(["applicable", "deferred", "inapplicable"]).toContain(item.state);
			if (item.state !== "applicable") expect(item.note).toBeTruthy();
		}
		expect(
			SECURITY_MANIFEST.filter((item) => item.state !== "applicable").map((item) => item.id),
		).toEqual(["I5", "DEC-12", "DEC-18", "DEC-20"]);
	});

	it("requires the AU1 ids and the deferred invariants, not later stages' ids", () => {
		const required = requiredIds();
		expect(required).toContain("C9");
		expect(required).toContain("I5");
		expect(required).toContain("I6");
		expect(required).toContain("DEC-07");
		expect(required).toContain("DEC-20");
		expect(required).not.toContain("F1");
		expect(required).not.toContain("M6");
		expect(required).not.toContain("DEC-10");
	});

	it("expands ranges with their padding", () => {
		expect(expandIds("N1, N2, N4–N6")).toEqual(["N1", "N2", "N4", "N5", "N6"]);
		expect(expandIds("DEC-04–DEC-06")).toEqual(["DEC-04", "DEC-05", "DEC-06"]);
	});
});

describe("check-security", () => {
	const allPassed = requiredIds().map((id): [string, string] => [`SEC-${id} works`, "passed"]);

	it("passes when every required id has a passed test", () => {
		expect(checkReport(report(allPassed))).toEqual({ missing: [], unknown: [] });
	});

	it("never counts skipped, todo or failed tests", () => {
		for (const status of ["skipped", "todo", "failed", "pending"]) {
			const tests = allPassed.map(([name], index): [string, string] => [
				name,
				index === 0 ? status : "passed",
			]);
			expect(checkReport(report(tests)).missing).toEqual([requiredIds()[0]]);
		}
	});

	it("matches ids on token boundaries and reports unknown ids", () => {
		const tests = allPassed.filter(([name]) => !name.startsWith("SEC-C1 "));
		tests.push(
			["SEC-C10 SEC-C11 suite > SEC-Z9 typo", "passed"],
			["xSEC-C1 glued", "passed"],
			["SEC-C1x glued", "passed"],
		);
		expect(checkReport(report(tests))).toEqual({ missing: ["C1"], unknown: [] });
		expect(checkReport(report([["SEC-I8 not an id", "passed"]])).unknown).toEqual(["I8"]);
	});
});
