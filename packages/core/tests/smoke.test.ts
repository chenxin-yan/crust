import { describe, expect, it } from "bun:test";
import {
	defineCommand,
	parseArgs,
	resolveCommand,
	runCommand,
	runMain,
} from "../src/index";

describe("smoke test", () => {
	it("should pass a trivial test", () => {
		expect(1 + 1).toBe(2);
	});

	it("should export defineCommand from @crust/core", () => {
		expect(typeof defineCommand).toBe("function");
	});

	it("should export parseArgs from @crust/core", () => {
		expect(typeof parseArgs).toBe("function");
	});

	it("should export resolveCommand from @crust/core", () => {
		expect(typeof resolveCommand).toBe("function");
	});

	it("should export runCommand and runMain from @crust/core", () => {
		expect(typeof runCommand).toBe("function");
		expect(typeof runMain).toBe("function");
	});
});
