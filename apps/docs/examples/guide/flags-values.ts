import { Crust } from "@crustjs/core";

const serve = new Crust("serve")
  .flags(
    { name: "target", type: "string", multiple: true, short: "t" },
    { name: "runtime", type: "string", choices: ["bun", "node"], default: "bun" },
    { name: "tag", type: "string" },
  )
  .action(({ flags, stdout }) => {
    stdout(
      `targets=${flags.target?.join(",") ?? "undefined"} runtime=${flags.runtime} tag=${String(flags.tag)}`,
    );
  });

await serve.execute();
