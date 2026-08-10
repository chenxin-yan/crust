import { Crust, defineCommand } from "../packages/core/src/index.ts";

const ITERATIONS = 2_000;
const WARMUP_ITERATIONS = 200;
const ARGV = ["deploy", "--target", "production", "--force"] as const;

function buildApp() {
	return new Crust("bench").flags({ name: "verbose", type: "boolean", short: "v" }).add(
		defineCommand("deploy", (command) =>
			command
				.flags(
					{ name: "target", type: "string", required: true },
					{ name: "force", type: "boolean", short: "f" },
				)
				.action(() => {}),
		),
		defineCommand("logs", (command) =>
			command.flags({ name: "follow", type: "boolean" }).action(() => {}),
		),
		defineCommand("status", (command) => command.action(() => {})),
		defineCommand("config", (command) =>
			command.add(
				defineCommand("get", (subcommand) => subcommand.action(() => {})),
				defineCommand("set", (subcommand) =>
					subcommand.args({ name: "key", type: "string", required: true }).action(() => {}),
				),
			),
		),
	);
}

function measureSync(iterations: number, operation: () => void): number {
	const started = performance.now();
	for (let index = 0; index < iterations; index++) operation();
	return ((performance.now() - started) * 1_000) / iterations;
}

async function measureAsync(iterations: number, operation: () => Promise<void>): Promise<number> {
	const started = performance.now();
	for (let index = 0; index < iterations; index++) await operation();
	return ((performance.now() - started) * 1_000) / iterations;
}

for (let index = 0; index < WARMUP_ITERATIONS; index++) buildApp();
const reusedApp = buildApp();
for (let index = 0; index < WARMUP_ITERATIONS; index++) await reusedApp.run(ARGV);

const grammarBuild = measureSync(ITERATIONS, () => {
	buildApp();
});
const reusedRun = await measureAsync(ITERATIONS, () => reusedApp.run(ARGV));
const buildAndRun = await measureAsync(ITERATIONS, async () => {
	await buildApp().run(ARGV);
});

console.table([
	{ probe: "grammar build", "µs/op": grammarBuild.toFixed(1) },
	{ probe: "run (reused app)", "µs/op": reusedRun.toFixed(1) },
	{ probe: "build + run", "µs/op": buildAndRun.toFixed(1) },
]);
