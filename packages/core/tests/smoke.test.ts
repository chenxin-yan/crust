import { describe, expect, it } from "bun:test";
import { Crust, parseArgs, resolveCommand } from "../src/index";

describe("smoke test", () => {
	it("should pass a trivial test", () => {
		expect(1 + 1).toBe(2);
	});

	it("should export Crust from @crustjs/core", () => {
		expect(typeof Crust).toBe("function");
	});

	it("should export parseArgs from @crustjs/core", () => {
		expect(typeof parseArgs).toBe("function");
	});

	it("should export resolveCommand from @crustjs/core", () => {
		expect(typeof resolveCommand).toBe("function");
	});
});
