import { describe, expect, it } from "bun:test";

import { CrustError } from "./errors.ts";
import { defineExtensionId } from "./identity.ts";

describe("defineExtensionId", () => {
	it("rejects blank ids", () => {
		expect(() => defineExtensionId(" \t\n")).toThrow(CrustError);
	});

	it("rejects untrimmed ids", () => {
		expect(() => defineExtensionId(" acme:docs ")).toThrow(CrustError);
	});

	it("returns the input string primitive", () => {
		expect<string>(defineExtensionId("acme:docs")).toBe("acme:docs");
	});
});
