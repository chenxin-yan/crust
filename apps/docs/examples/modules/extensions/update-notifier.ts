import { Crust } from "@crustjs/core";
import { updateNotifier } from "@crustjs/extensions";

const app = new Crust("my-cli", { version: "1.2.3" })
  .extend(
    updateNotifier({
      packageName: "my-cli",
      updateCommand: { scope: "global" },
    }),
  )
  .action(({ stdout }) => stdout("Done"));

await app.execute();
