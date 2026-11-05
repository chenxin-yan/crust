import { describe, expect, it } from "vite-plus/test";

import { packageManagerFromUserAgent } from "./package-manager.ts";

describe("packageManagerFromUserAgent", () => {
	it("recognizes supported package manager user agents", () => {
		expect(packageManagerFromUserAgent("bun/1.3.0")).toBe("bun");
		expect(packageManagerFromUserAgent("pnpm/10.0.0 node/v22")).toBe("pnpm");
		expect(packageManagerFromUserAgent("yarn/4.0.0 npm/?")).toBe("yarn");
		expect(packageManagerFromUserAgent("npm/10.0.0 node/v22")).toBe("npm");
		expect(packageManagerFromUserAgent("unknown/1.0.0")).toBeNull();
		expect(packageManagerFromUserAgent(undefined)).toBeNull();
	});
});
