import { describe, expect, it } from "vite-plus/test";

import { checkReport } from "./check-security.ts";
import { expandIds, requiredIds, SECURITY_MANIFEST } from "./security-manifest.ts";

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

const report = (tests: [string, string][]) => ({
	testResults: [{ assertionResults: tests.map(([fullName, status]) => ({ fullName, status })) }],
});

describe("security manifest", () => {
	it("lists every checklist id exactly once", () => {
		const ids = SECURITY_MANIFEST.map((item) => item.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect([...ids].sort()).toEqual([...CHECKLIST].sort());
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
