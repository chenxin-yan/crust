import { Crust, defineCommand, defineExtension, defineExtensionId } from "@crustjs/core";
// Crust's own writer: Bun leaves fd 1 non-blocking, so a raw `writeSync` throws EAGAIN when the
// parent drains the pipe slowly, and the markers must stay in order with Crust's output.
import { writeProcessOutput } from "@crustjs/utils/terminal";

import { didYouMean, help, noColor, version } from "../src/index.ts";

// One argv case per process; every `.extend()` permutation runs in turn, separated by
// markers on both streams, so the parent compares them byte for byte.
const argv: string[] = JSON.parse(process.argv[2]!);

const preview = defineExtension(defineExtensionId("acme:preview"))
	.flags({ preview: { type: "boolean", description: "Show the plan" } })
	.handle("preview", (ctx) => ctx.stdout("nothing changed"));

const stage = defineExtension(defineExtensionId("acme:stage")).setup(({ defer }) => {
	const previous = process.env.ACME_STAGE;
	process.env.ACME_STAGE = "staging";
	defer(() => {
		if (previous === undefined) delete process.env.ACME_STAGE;
		else process.env.ACME_STAGE = previous;
	});
});

// A gate must run before every action, after setups, and never when a handler or fallback takes over.
const gate = defineExtension(defineExtensionId("acme:gate")).preRun((ctx) => {
	if (process.env.ACME_STAGE !== "staging") throw new Error("gate ran before setup");
	ctx.stderr("[gate] checked");
});

const wrap = defineExtension(defineExtensionId("acme:wrap")).postRun((ctx, outcome) =>
	ctx.stderr(`[wrap] ${outcome.status}`),
);

const deploy = defineCommand("deploy", { description: "Deploy the app" }, (command) =>
	command.action(({ stdout }) => stdout(`deployed to ${process.env.ACME_STAGE}`)),
);
const db = defineCommand("db", { description: "Database tasks" }, (command) =>
	command.add(
		defineCommand("migrate", { description: "Run migrations" }, (child) =>
			child.action(({ stdout }) => stdout("migrated")),
		),
	),
);

const extensions = [
	noColor(),
	help(),
	version(),
	didYouMean(),
	preview,
	stage,
	gate,
	wrap,
] as const;

function* permutations<T>(items: readonly T[]): Generator<T[]> {
	if (items.length <= 1) {
		yield [...items];
		return;
	}
	for (let index = 0; index < items.length; index++) {
		const rest = [...items.slice(0, index), ...items.slice(index + 1)];
		for (const tail of permutations(rest)) yield [items[index]!, ...tail];
	}
}

let index = 0;
for (const order of permutations<(typeof extensions)[number]>(extensions)) {
	const marker = `@@${index++} ${order.map((extension) => extension.id).join(",")}@@\n`;
	writeProcessOutput(1, marker);
	writeProcessOutput(2, marker);
	const app = new Crust("my-cli", { version: "0.2.0" })
		.add(deploy, db)
		.extend(...order)
		.action(({ stdout }) => stdout("hello"));
	const code = await app.execute({ argv });
	writeProcessOutput(1, `@@exit ${code}@@\n`);
	process.exitCode = 0;
}
