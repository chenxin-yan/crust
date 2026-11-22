import { type AnyCrust, Crust } from "@crustjs/core";

import { defineApi } from "../../../src/index.ts";

const acme = defineApi({
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	// The test serves the API locally.
	baseUrl: process.env.ACME_BASE_URL ?? "https://api.acme.test",
});

export const app: AnyCrust = new Crust("acme").extend(acme.extension).add(...acme.commands);
