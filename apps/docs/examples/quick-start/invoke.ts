import { Crust } from "@crustjs/core";

const app = new Crust("my-cli")
  .args({ name: "name", type: "string", default: "world" })
  .flags({ name: "greet", type: "string", default: "Hello", short: "g" })
  .action(({ args, flags, stdout }) => stdout(`${flags.greet}, ${args.name}!`));

//#region run
const outcome = await app.run([], { args: { name: "Ada" }, flags: { greet: "Hi" } });
if (outcome.status === "failed") throw outcome.error;
if (outcome.status === "completed") console.log(outcome.stdout); // Hi, Ada!
//#endregion
