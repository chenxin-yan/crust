// The repo LICENSE lives at the monorepo root, so it is copied in for the
// duration of the build (crust reads ./LICENSE).
import { spawnSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const license = resolve(packageDir, "LICENSE");
copyFileSync(resolve(packageDir, "..", "..", "LICENSE"), license);
let status: number;
try {
	status =
		spawnSync(
			process.execPath,
			[resolve(packageDir, "..", "crust", "dist", "cli.js"), "build", ...process.argv.slice(2)],
			{ cwd: packageDir, stdio: "inherit" },
		).status ?? 1;
} finally {
	rmSync(license, { force: true });
}
process.exit(status);
