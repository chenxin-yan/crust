import { Crust } from "../src/index.ts";

// Shared by argv-runtime-parity.test.ts in-process (Node) and as a Bun subprocess.
const ARGVS: string[][] = [
	["x", "-z=x"],
	["x", "-zx"],
	["x", "-vz"],
	["--count", "-1"],
	["--verbose=1"],
	["--no-quiet"],
];

/** Runs every argv through one app and returns the stderr each invocation wrote. */
export async function argvErrors(): Promise<string[]> {
	const errors: string[] = [];
	for (const argv of ARGVS) {
		const lines: string[] = [];
		await new Crust("cli")
			.flags({
				verbose: { type: "boolean", short: "v" },
				count: { type: "number", short: "c" },
				quiet: { type: "boolean", noNegate: true },
			})
			.action(() => {})
			.execute({ argv, io: { stdout: () => {}, stderr: (text) => lines.push(text) } });
		errors.push(lines.join("\n"));
	}
	return errors;
}
