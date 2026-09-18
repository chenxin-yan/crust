import { Crust } from "@crustjs/core";

//#region defaults
const convert = new Crust("convert")
	.args(
		{ name: "input", type: "string", required: true },
		{ name: "format", type: "string", default: "json" },
		{ name: "label", type: "string" },
	)
	.action(({ args, stdout }) => {
		const input = args.input; // string
		const format = args.format; // string
		const label = args.label; // string | undefined
		stdout(`${input} -> ${format}${label ? ` (${label})` : ""}`);
	});
//#endregion

//#region variadic
const copy = new Crust("copy")
	.args(
		{ name: "destination", type: "path", required: true },
		{ name: "files", type: "path", variadic: true },
	)
	.action(({ args, stdout }) => stdout(`${args.files.length} files to ${args.destination}`));
//#endregion

//#region choices
const run = new Crust("run")
	.args({ name: "runtime", type: "string", choices: ["bun", "node"] })
	.action(({ args, stdout }) => stdout(`runtime: ${args.runtime}`));
//#endregion

//#region raw
const wrap = new Crust("wrap").action(({ rawArgs, stdout }) => stdout(rawArgs.join(" ")));
//#endregion

const examples = { convert, copy, run, wrap };
const [name = "", ...argv] = process.argv.slice(2);
const example = Object.entries(examples).find(([key]) => key === name)?.[1];
if (example) await example.execute({ argv });
