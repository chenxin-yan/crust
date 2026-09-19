import { expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const namespace = ["unshare", "--user", "--map-auto", "--map-root-user"];
// Starting a namespace alone does not prove its ownership/capability operations are allowed.
const canSetUpPermissions =
	process.platform === "linux" &&
	Bun.which("unshare") !== null &&
	Bun.which("setpriv") !== null &&
	Bun.spawnSync(
		[
			...namespace,
			"sh",
			"-c",
			`dir=$(mktemp -d) || exit 1
			trap 'rm -rf "$dir"' EXIT
			touch "$dir/probe" && chown 1:1 "$dir/probe" &&
			setpriv --bounding-set=-dac_override,-dac_read_search true`,
		],
		{ stdout: "ignore", stderr: "ignore" },
	).exitCode === 0;

it.skipIf(!canSetUpPermissions)(
	"resolves PATH using the caller's execute permissions, not the owner's",
	() => {
		const root = mkdtempSync(join(tmpdir(), "crust-which-permissions-"));
		try {
			const first = join(root, "first");
			const second = join(root, "second");
			mkdirSync(first);
			mkdirSync(second);
			for (const name of ["denied", "allowed"]) {
				writeFileSync(join(first, name), "#!/bin/sh\n");
				writeFileSync(join(second, name), "#!/bin/sh\n");
				chmodSync(join(second, name), 0o755);
			}
			chmodSync(join(first, "denied"), 0o744);
			chmodSync(join(first, "allowed"), 0o001);
			const probe = join(root, "probe.ts");
			writeFileSync(
				probe,
				`
			import assert from "node:assert/strict";
			import { which } from ${JSON.stringify(resolve(import.meta.dir, "../src/process.ts"))};
			process.env.PATH = ${JSON.stringify(`${first}:${second}`)};
			assert.equal(which("denied"), ${JSON.stringify(join(second, "denied"))});
			assert.equal(which("allowed"), ${JSON.stringify(join(first, "allowed"))});
		`,
			);
			const result = Bun.spawnSync(
				[
					...namespace,
					"sh",
					"-c",
					'chown 1:1 "$1" "$2" && exec setpriv --bounding-set=-dac_override,-dac_read_search "$3" "$4"',
					"sh",
					join(first, "denied"),
					join(first, "allowed"),
					process.execPath,
					probe,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);
