import { Crust, CrustError } from "@crustjs/core";

//#region schema
const positiveIntegerSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "example",
    validate(value: unknown) {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0
        ? { value: parsed }
        : { issues: [{ message: "Expected a positive integer" }] };
    },
  },
};

const hostSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "example",
    validate(value: unknown) {
      if (value === undefined) return { value: "localhost" };
      return typeof value === "string" ? { value } : { issues: [{ message: "Expected a string" }] };
    },
  },
};

const command = new Crust("serve")
  .args({ name: "port", schema: positiveIntegerSchema })
  .flags(
    { name: "host", type: "string", schema: hostSchema },
    { name: "workers", type: "string", schema: positiveIntegerSchema },
  )
  .action(({ args, flags }) => {
    args.port; // number
    flags.host; // string
    flags.workers; // number
  });

const outcome = await command.run([], {
  args: { port: "not-a-number" },
  flags: { workers: "not-a-number" },
});
if (
  outcome.status === "failed" &&
  outcome.error instanceof CrustError &&
  outcome.error.is("VALIDATION")
) {
  console.log(outcome.error.code);
  for (const issue of outcome.error.details?.issues ?? []) console.log(issue.path);
}
// VALIDATION
// args.port
// flags.workers
//#endregion
