// Executed-results gate (`pnpm run check:security`): reads Vitest's JSON report and fails
// unless every id the manifest requires has at least one passed test named `SEC-<id>`.
// Skipped, todo and failed tests never count; vite.config.ts makes every test assert.
import { readFileSync } from "node:fs";

import { requiredIds, SECURITY_MANIFEST } from "./security-manifest.ts";

interface JsonReport {
	testResults: { assertionResults: { fullName: string; status: string }[] }[];
}

/** `SEC-C1` never matches inside `SEC-C10`. */
export const SECURITY_ID: RegExp = /(?<![\w-])SEC-(DEC-\d{2}|[A-Q]\d{1,2})(?![\w-])/g;

/** Required ids without a passed test, and ids in test names the manifest does not know. */
export function checkReport(report: JsonReport): { missing: string[]; unknown: string[] } {
	const known = new Set(SECURITY_MANIFEST.map((item) => item.id));
	const passed = new Set<string>();
	const unknown = new Set<string>();
	for (const file of report.testResults) {
		for (const test of file.assertionResults) {
			for (const [, id] of test.fullName.matchAll(SECURITY_ID)) {
				if (!known.has(id!)) unknown.add(id!);
				else if (test.status === "passed") passed.add(id!);
			}
		}
	}
	return { missing: requiredIds().filter((id) => !passed.has(id)), unknown: [...unknown] };
}

if (import.meta.main) {
	const path = process.argv[2];
	if (!path) throw new Error("usage: node tests/check-security.ts <vitest-json-report>");
	const { missing, unknown } = checkReport(JSON.parse(readFileSync(path, "utf8")) as JsonReport);
	if (unknown.length > 0)
		console.error(`Test names use ids missing from the manifest: ${unknown.join(", ")}`);
	if (missing.length > 0) console.error(`No passed test for: ${missing.join(", ")}`);
	if (unknown.length > 0 || missing.length > 0) process.exit(1);
	console.log(`check:security: ${requiredIds().length} required ids each have a passed test.`);
}
