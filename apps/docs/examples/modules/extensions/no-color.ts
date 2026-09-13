import { Crust } from "@crustjs/core";
import { noColor } from "@crustjs/extensions";

const app = new Crust("my-cli")
  .extend(noColor())
  .action(({ stdout }) =>
    stdout(
      `FORCE_COLOR=${process.env.FORCE_COLOR ?? "unset"} NO_COLOR=${process.env.NO_COLOR ?? "unset"}`,
    ),
  );

await app.execute();
