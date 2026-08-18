import { describe, expect, it } from "bun:test";

import { CrustError } from "./errors.ts";
import { defineExtensionId } from "./identity.ts";

describe("defineExtensionId", () => {
	it("rejects blank ids", () => {
		expect(() => defineExtensionId(" \t\n")).toThrow(CrustError);
	});

	it("remains a plain string across serialization", () => {
		const id = defineExtensionId("acme:docs");
		expect(structuredClone(id)).toBe(id);
		expect(JSON.parse(JSON.stringify(id))).toBe(id);
	});
});
