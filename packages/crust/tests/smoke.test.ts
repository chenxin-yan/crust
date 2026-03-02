import { describe, expect, it } from "bun:test";
import { Crust, parseArgs, resolveCommand } from "@crustjs/core";

describe("crust package smoke test", () => {
	it("should re-export Crust from @crustjs/core", () => {
		expect(typeof Crust).toBe("function");
	});

	it("should re-export parseArgs from @crustjs/core", () => {
		expect(typeof parseArgs).toBe("function");
	});

	it("should re-export resolveCommand from @crustjs/core", () => {
		expect(typeof resolveCommand).toBe("function");
	});

	it("should pass a trivial test", () => {
		expect(true).toBe(true);
	});
});
