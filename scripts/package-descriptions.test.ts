import { globSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { expect, it } from "vite-plus/test";

// Each package.json `description` is the one source of truth; npm shows it, and
// the README tagline and root package table must repeat it verbatim.

const repoRoot = resolve(import.meta.dirname, "..");

// Published but workspace-internal, so the root README does not advertise it.
const UNLISTED_IN_ROOT_README = new Set(["@crustjs/utils"]);

const published = globSync("packages/*/package.json", { cwd: repoRoot }).flatMap((path) => {
	const manifest = JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as {
		name: string;
		description: string;
		private?: boolean;
	};
	return manifest.private ? [] : [{ ...manifest, dir: join(repoRoot, dirname(path)) }];
});

it.each(published)("$name README tagline is its package.json description", (pkg) => {
	const readme = readFileSync(join(pkg.dir, "README.md"), "utf8");
	const [heading, tagline] = readme.split("\n").filter((line) => line.trim() !== "");
	expect(heading).toBe(`# ${pkg.name}`);
	expect(tagline).toBe(pkg.description);
});

it("root README package table lists the public packages with their descriptions", () => {
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const rows = [...readme.matchAll(/^\| \[`([^`]+)`\]\([^)]+\) +\| (.+?) +\|/gm)];
	const listed = Object.fromEntries(rows.map(([, name, description]) => [name, description]));
	const expected = Object.fromEntries(
		published
			.filter((pkg) => !UNLISTED_IN_ROOT_README.has(pkg.name))
			.map((pkg) => [pkg.name, pkg.description]),
	);
	expect(rows).toHaveLength(Object.keys(listed).length);
	expect(listed).toEqual(expected);
});
