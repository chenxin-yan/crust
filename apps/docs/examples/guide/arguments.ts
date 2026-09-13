import { Crust } from "@crustjs/core";

//#region defaults
const convert = new Crust("convert")
  .args(
    { name: "input", type: "string", required: true },
    { name: "format", type: "string", default: "json" },
    { name: "label", type: "string" },
  )
  .action(({ args, stdout }) => {
    args.input; // string
    args.format; // string
    args.label; // string | undefined
    stdout(`${args.input} -> ${args.format}${args.label ? ` (${args.label})` : ""}`);
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
if (name in examples) await examples[name as keyof typeof examples].execute({ argv });
