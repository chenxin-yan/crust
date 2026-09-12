import { Crust } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";

import pkg from "../package.json";

const app = new Crust("my-cli", { description: "A CLI built with Crust", version: pkg.version })
  .extend(version(), help())
  .args({
    name: "name",
    type: "string",
    description: "Your name",
    default: "world",
  })
  .flags({
    name: "greet",
    type: "string",
    description: "Greeting to use",
    default: "Hello",
    short: "g",
  })
  .action(({ args, flags, stdout }) => {
    stdout(`${flags.greet}, ${args.name}!`);
  })
  // [!code ++:5]
  .command("build", (command) =>
    command
      .flags({ name: "minify", type: "boolean", description: "Minify output" })
      .action(({ flags, stdout }) => stdout(`minify: ${flags.minify ?? false}`)),
  );

await app.execute();
