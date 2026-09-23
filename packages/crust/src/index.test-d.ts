/**
 * Compile-only check of the public library surface. The body mirrors the
 * "Programmatic builds" example in apps/docs/content/docs/guide/build-and-distribution.mdx,
 * which imports from "@crustjs/crust"; keep the two in sync.
 */
import type { BuildArtifact, BuildOptions, BuildReport, BuildResult } from "./index.ts";
import { build } from "./index.ts";

async function release(): Promise<void> {
	const result = await build({
		cwd: process.cwd(), // default; package.json bin and crust are read from here
		targets: ["bun-linux-x64", "bun-darwin-arm64"], // overrides crust.targets; omit for config, then every target
		envFiles: [".env.production"],
		onLog: (line) => console.log(line), // silent without it
	});

	console.log(result.stageDir); // <cwd>/.crust
	for (const artifact of result.artifacts) {
		if (artifact.kind === "executable") {
			console.log(`${artifact.command} for ${artifact.target}: ${artifact.path}`);
		}
	}
	for (const [command, report] of Object.entries(result.reports ?? {})) {
		console.log(
			command,
			report.extensions.map((extension) => extension.id),
		);
	}
}

// Every option is optional; the callback may take the stream too.
const options: BuildOptions = {};
const withStream: BuildOptions = { onLog: (_line, stream) => stream satisfies "stdout" | "stderr" };
const artifact: BuildArtifact = { kind: "launcher", path: "/x/.crust/root/bin/x.js", command: "x" };
const result: Promise<BuildResult> = build(options);
declare const report: BuildReport;
report.extensions[0]?.files satisfies readonly string[] | undefined;

// @ts-expect-error unknown option
void build({ target: ["bun-linux-x64"] });
// @ts-expect-error an executable always names its target
const executable: BuildArtifact = { kind: "executable", path: "", command: "x" };

void release;
void withStream;
void artifact;
void result;
void executable;
