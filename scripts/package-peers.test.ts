import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, it } from "vite-plus/test";

// The optional TypeScript peer states which compilers Crust's types support. npm
// rejects an install whose TypeScript misses any package's range (ERESOLVE), so
// one package with a narrower range breaks every project on the excluded versions.

const repoRoot = resolve(import.meta.dirname, "..");

it("every package declares the same optional TypeScript peer", () => {
	const peers = globSync("packages/*/package.json", { cwd: repoRoot }).flatMap((path) => {
		const manifest = JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as {
			name: string;
			peerDependencies?: Record<string, string>;
			peerDependenciesMeta?: Record<string, { optional?: boolean }>;
		};
		const range = manifest.peerDependencies?.typescript;
		if (range === undefined) return [];
		return [
			{ name: manifest.name, range, optional: manifest.peerDependenciesMeta?.typescript?.optional },
		];
	});
	expect(peers.length).toBeGreaterThan(0);
	const range = peers[0]!.range;
	expect(peers).toEqual(peers.map(({ name }) => ({ name, range, optional: true })));
});
