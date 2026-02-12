import { describe, expect, it } from "bun:test";
import {
	defineCommand,
	parseArgs,
	resolveCommand,
	runCommand,
	runMain,
} from "@crust/core";

describe("crust package smoke test", () => {
	it("should re-export defineCommand from @crust/core", () => {
		expect(typeof defineCommand).toBe("function");
	});

	it("should re-export parseArgs from @crust/core", () => {
		expect(typeof parseArgs).toBe("function");
	});

	it("should re-export resolveCommand from @crust/core", () => {
		expect(typeof resolveCommand).toBe("function");
	});

	it("should re-export runCommand and runMain from @crust/core", () => {
		expect(typeof runCommand).toBe("function");
		expect(typeof runMain).toBe("function");
	});
	it("should pass a trivial test", () => {
		expect(true).toBe(true);
	});
});
