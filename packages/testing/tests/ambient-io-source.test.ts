import { describe, expect, it } from "bun:test";

import { Crust } from "../../core/src/index.ts";
import { spinner, withProgressSink } from "../../progress/src/index.ts";
import { getAmbientTerminalIO } from "../../utils/src/terminal.ts";

describe("ambient invocation IO source integration", () => {
	it("captures spinner output only when invocation IO establishes the scope", async () => {
		const errors: string[] = [];
		const observed: ReturnType<typeof getAmbientTerminalIO>[] = [];
		const app = new Crust("ambient-source").action(async () => {
			observed.push(getAmbientTerminalIO());
			await spinner({ message: "Source bridge", task: async () => undefined });
		});

		await app.execute({
			argv: [],
			io: { stdout: () => {}, stderr: (text) => errors.push(text) },
		});
		await withProgressSink({ isTTY: false, write: () => {} }, () => app.execute({ argv: [] }));

		expect(errors).toEqual(["✓ Source bridge"]);
		expect(observed[0]?.stderr).toBeDefined();
		expect(observed[1]).toBeUndefined();
	});
});
