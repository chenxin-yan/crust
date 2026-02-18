import { describe, expect, it } from "bun:test";
import {
	defineCommand,
	parseArgs,
	resolveCommand,
	runCommand,
	runMain,
} from "@crustjs/core";

describe("crust package smoke test", () => {
	it("should re-export defineCommand from @crustjs/core", () => {
		expect(typeof defineCommand).toBe("function");
	});

	it("should re-export parseArgs from @crustjs/core", () => {
		expect(typeof parseArgs).toBe("function");
	});

	it("should re-export resolveCommand from @crustjs/core", () => {
		expect(typeof resolveCommand).toBe("function");
	});

	it("should re-export runCommand and runMain from @crustjs/core", () => {
		expect(typeof runCommand).toBe("function");
		expect(typeof runMain).toBe("function");
	});
	it("should pass a trivial test", () => {
		expect(true).toBe(true);
	});
});
