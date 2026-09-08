import { Crust } from "@crustjs/core";
import { help } from "@crustjs/extensions";

const app = new Crust("greet")
  .extend(help())
  .args({ name: "name", type: "string", default: "world" })
  .flags({ name: "shout", type: "boolean", short: "s" })
  .action(({ args, flags, stdout }) => {
    const line = `Hello, ${args.name}!`;
    stdout(flags.shout ? line.toUpperCase() : line);
  })
  .command("wave", (command) =>
    command.action(({ stdout }) => stdout("👋")),
  );

await app.execute();
