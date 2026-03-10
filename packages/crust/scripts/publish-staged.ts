import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type PublishManifest = {
	publishOrder: string[];
};

const manifestPath = resolve(process.cwd(), "dist/npm/manifest.json");

if (!existsSync(manifestPath)) {
	throw new Error(
		`Staged manifest not found at ${manifestPath}\n  Run \`bun run package\` before publishing staged packages.`,
	);
}

const manifest = JSON.parse(
	readFileSync(manifestPath, "utf-8"),
) as PublishManifest;

for (const dir of manifest.publishOrder) {
	const packageDir = resolve(process.cwd(), "dist/npm", dir);
	console.log(`Publishing ${packageDir}...`);

	const proc = Bun.spawn(
		[process.execPath, "publish", "--access", "public", "--no-git-checks"],
		{
			cwd: packageDir,
			stdout: "inherit",
			stderr: "inherit",
		},
	);

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(
			`bun publish failed for ${packageDir} with exit code ${exitCode}`,
		);
	}
}
