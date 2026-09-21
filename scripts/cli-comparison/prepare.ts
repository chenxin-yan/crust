import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const here = import.meta.dirname;
// CRUST_ROOT lets the harness build local Crust from another checkout (e.g. a
// stacked-PR worktree) while the benchmark itself stays here.
const root = process.env.CRUST_ROOT ?? resolve(here, "../..");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
// Default pin is the frozen baseline; set EXPECTED_REVISION to measure another commit.
const expected = process.env.EXPECTED_REVISION ?? "b79c147ad81549d5cf8755993bf707b539fda996";
if (revision !== expected) throw new Error(`Unexpected local revision: ${revision}`);
if (
	execFileSync(
		"git",
		["diff", "HEAD", "--", "packages/core", "packages/utils", "tsdown.config.ts"],
		{ cwd: root },
	).length
)
	throw new Error("Local Crust source is dirty");
const artifacts: Record<string, string> = {};
for (const name of ["utils", "core"]) {
	const source = join(root, "packages", name);
	rmSync(join(source, "dist"), { recursive: true, force: true });
	execFileSync("bun", ["run", "build"], { cwd: source, stdio: "inherit", timeout: 120_000 });
	const dest = join(here, ".generated/local", name);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });
	cpSync(join(source, "dist"), join(dest, "dist"), { recursive: true });
	const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	writeFileSync(join(dest, "package.json"), JSON.stringify(pkg, null, 2));
	const link = join(here, "node_modules/@crustjs", name);
	mkdirSync(join(here, "node_modules/@crustjs"), { recursive: true });
	rmSync(link, { recursive: true, force: true });
	symlinkSync(dest, link, "dir");
	for (const file of readdirSync(join(dest, "dist"))) {
		artifacts[`${name}/dist/${file}`] = createHash("sha256")
			.update(readFileSync(join(dest, "dist", file)))
			.digest("hex");
	}
}
writeFileSync(
	join(here, ".generated/local.json"),
	JSON.stringify(
		{
			revision,
			artifacts,
			rootLockSha256: createHash("sha256")
				.update(readFileSync(join(root, "bun.lock")))
				.digest("hex"),
			tsdown: JSON.parse(readFileSync(join(root, "node_modules/tsdown/package.json"), "utf8"))
				.version,
			bun: Bun.version,
			builtAt: new Date().toISOString(),
			command: "bun run build (utils then core; dist cleared first)",
		},
		null,
		2,
	),
);
