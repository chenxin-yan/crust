import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { version } from "./version.ts";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("version", () => {
	it("version extension prints the version instead of an invalid flag value from argv or env", async () => {
		let ran = false;
		const app = new Crust("app")
			.extend(version("1.2.3"))
			.flags({ port: { type: "number", default: 3000, env: { name: "PORT" } } })
			.action(() => {
				ran = true;
			});

		for (const argv of [
			["--port", "abc", "--version"],
			["--version", "--port", "abc"],
		]) {
			expect(await captureExecute(app, argv), argv.join(" ")).toMatchObject({
				stdout: "app v1.2.3",
				stderr: "",
				exitCode: 0,
			});
		}

		vi.stubEnv("PORT", "abc");
		expect(await captureExecute(app, ["--version"])).toMatchObject({
			stdout: "app v1.2.3",
			stderr: "",
			exitCode: 0,
		});
		const failed = await captureExecute(app, []);
		expect(failed.stderr).toContain("Expected a number for --port (from $PORT).");
		expect(failed.exitCode).toBe(1);
		expect(ran).toBe(false);
	});

	it("version extension handles --version from root metadata", async () => {
		const app = new Crust("app", { version: "1.2.3" }).extend(version()).action(() => {});

		const { stdout } = await captureExecute(app, ["--version"]);

		expect(stdout).toContain("app v1.2.3");
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
		expect(stdout).toBe("app v2.0.0");
	});

	it("version extension supports plain format", async () => {
		const app = new Crust("app").extend(version("1.2.3", { format: "plain" })).action(() => {});

		const { stdout } = await captureExecute(app, ["--version"]);

		expect(stdout).toBe("1.2.3");
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

		expect(stdout).toBe("app/1.2.3");
	});
});
