// Stages create-crust with `crust build`, inlining the Crust versions that the
// scaffolded package.json files pin. The repo LICENSE lives at the monorepo
// root, so it is copied in for the duration of the build (crust reads ./LICENSE).
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const packagesDir = resolve(packageDir, "..");
const version = (name: string): string =>
	JSON.parse(readFileSync(resolve(packagesDir, name, "package.json"), "utf8")).version;

const license = resolve(packageDir, "LICENSE");
copyFileSync(resolve(packagesDir, "..", "LICENSE"), license);
let status: number;
try {
	status =
		spawnSync(
			process.execPath,
			[
				resolve(packagesDir, "crust", "dist", "cli.js"),
				"build",
				"--entry",
				"src/index.ts",
				...process.argv.slice(2),
			],
			{
				cwd: packageDir,
				stdio: "inherit",
				env: {
					...process.env,
					PUBLIC_CRUST_CORE_VERSION: version("core"),
					PUBLIC_CRUST_CLI_VERSION: version("crust"),
					PUBLIC_CRUST_EXTENSIONS_VERSION: version("extensions"),
				},
			},
		).status ?? 1;
} finally {
	rmSync(license, { force: true });
}
process.exit(status);
