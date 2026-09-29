import { app } from "./app.ts";
import { greetCommand } from "./commands/greet.ts";

const cli = app.add(greetCommand);

const outcome = await cli.run(["greet"], { args: { name: "Ada" }, flags: { greeting: "Hi" } });
if (outcome.status === "failed") throw outcome.error;
console.log(outcome.stdout); // => Hi, Ada!
