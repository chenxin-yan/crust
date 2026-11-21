// A command that does not read the config must not pay for loading @crustjs/store. The fixture is
// bundled as `crust build` bundles a CLI, with the store left out of the bundle so that a real
// process can report when it is loaded.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const fixture = join(import.meta.dirname, "fixtures", "startup");
const hasBun = spawnSync("bun", ["--version"]).status === 0;
let built = "";
let home = "";

// Logs each import of the store as Node resolves it.
const HOOKS = `import { registerHooks } from "node:module";
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "@crustjs/store") process.stderr.write("loaded @crustjs/store\\n");
		return nextResolve(specifier, context);
	},
});
`;

function acme(command: string, env: Record<string, string> = {}) {
	const result = spawnSync(
		process.execPath,
		["--import", join(built, "hooks.mjs"), join(built, "cli.mjs"), command],
		{
			cwd: home,
			encoding: "utf8",
			env: {
				...process.env,
				XDG_CONFIG_HOME: join(home, "xdg"),
				APPDATA: join(home, "xdg"),
				...env,
			},
			timeout: 30_000,
		},
	);
	if (result.error) throw result.error;
	return result;
}

describe.skipIf(!hasBun)("a built CLI", () => {
	beforeAll(() => {
		// Inside the package, so the bundle resolves the external store from its node_modules.
		built = mkdtempSync(join(fixture, ".built-"));
		home = mkdtempSync(join(tmpdir(), "crust-config-startup-"));
		writeFileSync(join(built, "hooks.mjs"), HOOKS);
		const result = spawnSync(
			"bun",
			[
				"build",
				join(fixture, "cli.ts"),
				"--target=node",
				"--define",
				'process.env.CRUST_INTERNAL_BUILD="1"',
				"--external",
				"@crustjs/store",
				"--outfile",
				join(built, "cli.mjs"),
			],
			{ encoding: "utf8", timeout: 60_000 },
		);
		expect(result.status, result.stderr).toBe(0);
	});

	afterAll(() => {
		rmSync(built, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it("does not load the store for a command that uses no setting", () => {
		const { status, stdout, stderr } = acme("ping");
		expect(status, stderr).toBe(0);
		expect(stdout).toBe("pong\n");
		expect(stderr).not.toContain("loaded @crustjs/store");
	});

	it("does not load the store for a setting its variable gave", () => {
		const { status, stdout, stderr } = acme("show", { ACME_ORG: "acme-corp" });
		expect(status, stderr).toBe(0);
		expect(stdout).toBe("org=acme-corp\n");
		expect(stderr).not.toContain("loaded @crustjs/store");
	});

	it("loads the store when a setting comes from the files", () => {
		const { status, stdout, stderr } = acme("show");
		expect(status, stderr).toBe(0);
		expect(stdout).toBe("org=undefined\n");
		expect(stderr).toContain("loaded @crustjs/store");
	});
});
