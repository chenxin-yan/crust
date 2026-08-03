import { Crust } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";

const app = new Crust("greet")
  .extend(help(), version("1.0.0"))
  .args({ name: "name", type: "string", default: "world" })
  .flags({ name: "shout", type: "boolean", short: "s" })
  .handle(({ args, flags, stdout }) => {
    // args.name: string · flags.shout: boolean | undefined
    const line = `Hello, ${args.name}!`;
    stdout(flags.shout ? line.toUpperCase() : line);
  });

await app.execute();
