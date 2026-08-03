import { Crust } from "@crustjs/core";

const app = new Crust("my-cli")
  .args({ name: "name", type: "string", default: "world" })
  .flags({ name: "greet", type: "string", default: "Hello", short: "g" })
  .handle(({ args, flags, stdout }) => stdout(`${flags.greet}, ${args.name}!`));

//#region run
const output: string[] = [];

await app.run(["Ada", "--greet", "Hi"], {
  stdout: (line) => output.push(line),
  stderr: (line) => output.push(line),
});
//#endregion
