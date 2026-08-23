import { describe, expect, it } from "bun:test";

import { isErrnoException } from "./error.ts";

describe("isErrnoException", () => {
	it("accepts only Error instances with string codes", () => {
		const errno = Object.assign(new Error("missing"), { code: "ENOENT" });
		const numericCode = Object.assign(new Error("bad code"), { code: 404 });

		expect(isErrnoException(errno)).toBe(true);
		expect(isErrnoException(numericCode)).toBe(false);
		expect(isErrnoException({ code: "ENOENT" })).toBe(false);
	});
});
