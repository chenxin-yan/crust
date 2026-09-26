import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { BUILD_OUT_DIR_ENV, SNAPSHOT_PATH_ENV } from "@crustjs/core/tooling";
import { afterEach, expect, it } from "vite-plus/test";

import { runBuildHooks } from "./build-hooks.ts";

const originalEnv = process.env;
afterEach(() => {
	process.env = originalEnv;
});

it.each([undefined, "", "/existing/build"])(
	"restores build settings (%s) after successful and failed hooks",
	async (value) => {
		process.env = { ...originalEnv };
		for (const key of [SNAPSHOT_PATH_ENV, BUILD_OUT_DIR_ENV]) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		for (const fail of [false, true]) {
			const extension = defineExtension(defineExtensionId("test:build-env")).build(() => {
				if (fail) throw new Error("build failed");
				return [{ path: "output.txt", content: "built" }];
			});
			const result = await runBuildHooks(new Crust("test").extend(extension));
			if (fail) expect(result.error).toContain("build failed");
			else expect(result.files.get("output.txt")).toBe("built");
			expect(process.env[SNAPSHOT_PATH_ENV]).toBe(value);
			expect(process.env[BUILD_OUT_DIR_ENV]).toBe(value);
		}
	},
);
