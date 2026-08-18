import * as core from "../../packages/core/dist/index.js";
import * as create from "../../packages/create/dist/index.js";
import * as extensions from "../../packages/extensions/dist/index.js";
import * as man from "../../packages/man/dist/index.js";
import * as progress from "../../packages/progress/dist/index.js";
import * as prompts from "../../packages/prompts/dist/index.js";
import * as skills from "../../packages/skills/dist/index.js";
import * as store from "../../packages/store/dist/index.js";
import * as style from "../../packages/style/dist/index.js";
import * as testing from "../../packages/testing/dist/index.js";

const roots = {
	core: core.Crust,
	create: create.interpolate,
	extensions: extensions.help,
	man: man.man,
	progress: progress.progress,
	prompts: prompts.createPrompts,
	skills: skills.SKILLS,
	store: store.createStore,
	style: style.stringWidth,
	testing: testing.captureRun,
};
for (const [name, value] of Object.entries(roots)) {
	if (value === undefined) throw new Error(`Missing root export from @crustjs/${name}`);
}

const stdout = [];
const originalLog = console.log;
console.log = (...values) => stdout.push(values.join(" "));
try {
	const app = new core.Crust("runtime-smoke").extend(extensions.help()).action(() => {});
	await app.execute({ argv: ["--help"] });
} finally {
	console.log = originalLog;
}
const output = stdout.join("\n");
if (!output.includes("runtime-smoke") || !output.includes("Usage:")) {
	throw new Error(`Sample CLI help output was incomplete:\n${output}`);
}
originalLog(`runtime-smoke-ok (${Object.keys(roots).length} package roots)`);
