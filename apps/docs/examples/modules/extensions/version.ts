import { Crust } from "@crustjs/core";
import { version } from "@crustjs/extensions";

const app = new Crust("my-cli", { version: "1.2.3" }).extend(version()).action(() => {});

await app.execute();
