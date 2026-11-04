import { describe, expect, it } from "vite-plus/test";

import { defineExtensionId } from "./identity.ts";

describe("defineExtensionId", () => {
	it("rejects blank and untrimmed dynamic ids", () => {
		for (const id of ["", " ", " acme:docs", "acme:docs\n"] as string[]) {
			expect(() => defineExtensionId(id), JSON.stringify(id)).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: { subject: "extension", reason: "empty-id" },
				}),
			);
		}
	});
});
