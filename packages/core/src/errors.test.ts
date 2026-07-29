import { describe, expect, it } from "bun:test";

import { createCommandNode } from "./command/node.ts";
import { snapshotCommand } from "./command/snapshot.ts";
import { CrustError } from "./errors.ts";

describe("CrustError shape", () => {
	it("provides a stable code and details", () => {
		const error = new CrustError("PARSE", "Unknown flag", {
			flag: "--wat",
			reason: "unknown-flag",
		});

		expect(error).toBeInstanceOf(Error);
		expect(error.code).toBe("PARSE");
		expect(error.details?.flag).toBe("--wat");
	});

	it("serializes error metadata without a _tag and without serializing causes", () => {
		const cause = new Error("inner");
		const error = new CrustError("VALIDATION", "Failed", {
			issues: [{ message: "bad", path: "flags.x" }],
		}).withCause(cause);

		expect(error.toJSON()).toEqual({
			code: "VALIDATION",
			message: "Failed",
			details: { issues: [{ message: "bad", path: "flags.x" }] },
		});
		expect("_tag" in error).toBe(false);
	});

	it("keeps command not found details strongly structured", () => {
		const parentCommand = snapshotCommand(createCommandNode("cli"));
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
