// Guards the private-package inlining: @crustjs/utils is unpublished, so any
// dist artifact that still imports it would break real installs (js) or
// consumer typechecking (d.ts). tsdown inlines it because it is a
// devDependency; this catches a package.json/config drift that stops that.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const consumers = ["core", "create", "progress", "prompts", "skills", "store"];
// ponytail: line-based comment skip, not a JS parser — dist JSDoc examples
// mention @crustjs/utils; real specifiers only appear in top-level code lines.
const commentLine = /^\s*(\*|\/\/|\/\*)/;
const specifier = /["']@crustjs\/utils(\/|["'])/;

const leaks = [];
for (const pkg of consumers) {
	const dist = join("packages", pkg, "dist");
	for (const file of readdirSync(dist).filter((f) => /\.(js|d\.ts)$/.test(f))) {
		const lines = readFileSync(join(dist, file), "utf8").split("\n");
		for (const [i, line] of lines.entries()) {
			if (!commentLine.test(line) && specifier.test(line)) {
				leaks.push(`${dist}/${file}:${i + 1}: ${line.trim()}`);
			}
		}
	}
}

if (leaks.length > 0) {
	console.error("@crustjs/utils leaked into published dist output:");
	for (const leak of leaks) console.error(`  ${leak}`);
	process.exit(1);
}
console.log(`dist-inlined-utils ok (${consumers.length} packages)`);
