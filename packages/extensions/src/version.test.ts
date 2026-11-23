import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { version } from "./version.ts";

describe("version", () => {
	it("version extension prints the version instead of an invalid flag value from argv or env", async () => {
		let ran = false;
		const app = new Crust("app")
			.extend(version("1.2.3"))
			.flags({ port: { type: "number", default: 3000, env: "PORT" } })
			.action(() => {
				ran = true;
			});

		for (const argv of [
			["--port", "abc", "--version"],
			["--version", "--port", "abc"],
		]) {
			expect(await captureExecute(app, argv), argv.join(" ")).toMatchObject({
				stdout: "app v1.2.3\n",
				stderr: "",
				exitCode: 0,
			});
		}

		const env = { PORT: "abc" };
		expect(await captureExecute(app, ["--version"], { env })).toMatchObject({
			stdout: "app v1.2.3\n",
			stderr: "",
			exitCode: 0,
		});
		const failed = await captureExecute(app, [], { env });
		expect(failed.stderr).toContain("Expected a number for --port (from $PORT).");
		expect(failed.exitCode).toBe(2);
		expect(ran).toBe(false);
	});

	it("evaluates a version provider only when the root version flag is handled", async () => {
		let calls = 0;
		const extension = version(() => {
			calls++;
			return "2.0.0";
		});
		const app = new Crust("app").extend(extension).action(() => {});
		expect(extension.id).toBe(version.id);
		await app.snapshot();
		await captureExecute(app, []);
		expect(calls).toBe(0);
		const { stdout } = await captureExecute(app, ["--version"]);
		expect(calls).toBe(1);
		expect(stdout).toBe("app v2.0.0\n");
	});

	it("keeps --version on the root, before or after a subcommand name", async () => {
		const app = new Crust("app")
			.extend(version("1.2.3"))
			.command("install", (install) => install.action(() => {}));
		for (const argv of [
			["--version", "install"],
			["install", "--version"],
		]) {
			const result = await captureExecute(app, argv);
			expect(result.stdout, argv.join(" ")).toBe("");
			expect(result.stderr).toContain('Unknown flag "--version"');
			expect(result.exitCode).toBe(2);
		}
	});

	it.each([
		[undefined, "-v", "-V"],
		["V", "-V", "-v"],
	] as const)(
		"short %s prints the version for %s and not for %s",
		async (short, spelled, other) => {
			const app = new Crust("app").extend(version("1.2.3", { short })).action(() => {});

			expect(await captureExecute(app, [spelled])).toMatchObject({
				stdout: "app v1.2.3\n",
				exitCode: 0,
			});
			expect(await captureExecute(app, [other])).toMatchObject({ stdout: "", exitCode: 2 });
		},
	);

	it("short false leaves only --version, so the app can declare -v", async () => {
		const app = new Crust("app")
			.extend(version("1.2.3", { short: false }))
			.flags({ verbose: { type: "boolean", short: "v" } })
			.action(({ flags, stdout }) => stdout(`verbose ${flags.verbose}`));

		expect((await captureExecute(app, ["-v"])).stdout).toBe("verbose true\n");
		expect((await captureExecute(app, ["--version"])).stdout).toBe("app v1.2.3\n");
	});

	it("version extension supports plain format", async () => {
		const app = new Crust("app").extend(version("1.2.3", { format: "plain" })).action(() => {});

		const { stdout } = await captureExecute(app, ["--version"]);

		expect(stdout).toBe("1.2.3\n");
	});

	it("version extension supports a custom format function", async () => {
		const app = new Crust("app")
			.extend(
				version("1.2.3", {
					format: (version, context) => `${context.rootCommand.meta.name}/${version}`,
				}),
			)
			.action(() => {});

		const { stdout } = await captureExecute(app, ["--version"]);

		expect(stdout).toBe("app/1.2.3\n");
	});
});
