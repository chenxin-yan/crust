import { describe, expect, it } from "vite-plus/test";

import { CrustError } from "./errors.ts";
import { defineExtensionId } from "./identity.ts";

describe("defineExtensionId", () => {
	it("rejects untrimmed ids", () => {
		expect(() => defineExtensionId(" acme:docs ")).toThrow(CrustError);
	});
});
