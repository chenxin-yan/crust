// #region handle
import { Crust, CrustError } from "@crustjs/core";
import { z } from "zod";

const app = new Crust("serve")
	.flags({ name: "port", type: "string", schema: z.coerce.number().int().min(1) })
	.action(({ flags, stdout }) => stdout(`listening on ${flags.port}`));

const outcome = await app.run([], { flags: { port: "0" } });
if (outcome.status === "failed") {
	const { error } = outcome;
	if (error instanceof CrustError && error.is("VALIDATION")) {
		for (const issue of error.details?.issues ?? []) {
			console.error(`${issue.path}: ${issue.message}`); // => flags.port: …
		}
	} else if (error instanceof Error && error.name === "AbortError") {
		// cancelled
	} else {
		throw error;
	}
}
// #endregion handle
