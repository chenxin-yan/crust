import { describe, expect, it } from "bun:test";

import { createCommandNode } from "./command/node.ts";
import { CrustError } from "./errors.ts";

describe("CrustError tagged shape", () => {
	it("provides a stable tag and static guard", () => {
		const error = CrustError.parse("Unknown flag", {
			flag: "--wat",
			reason: "unknown-flag",
		});

		expect(error).toBeInstanceOf(Error);
		expect(CrustError.is(error)).toBe(true);
		expect(error._tag).toBe("CrustPARSEError");
		expect(error.code).toBe("PARSE");
		expect(error.details?.flag).toBe("--wat");
	});

	it("serializes tagged error metadata without serializing causes", () => {
		const cause = new Error("inner");
		const error = CrustError.execution("Failed", { phase: "run" }).withCause(cause);

		expect(error.toJSON()).toEqual({
			_tag: "CrustEXECUTIONError",
			code: "EXECUTION",
			message: "Failed",
			details: { phase: "run" },
		});
	});

	it("keeps command not found details strongly structured", () => {
		const parentCommand = createCommandNode("cli");
		const error = CrustError.commandNotFound('Unknown command "buld".', {
			input: "buld",
			available: ["build"],
			commandPath: ["cli"],
			parentCommand,
		});

		if (!error.is("COMMAND_NOT_FOUND")) {
			throw new Error("expected command-not-found");
		}

		expect(error.details.parentCommand).toBe(parentCommand);
		expect(error.details.available).toEqual(["build"]);
	});
});
