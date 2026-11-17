import { type AnyCrust, Crust } from "@crustjs/core";

import { defineApi } from "../../../src/index.ts";

const acme = defineApi({
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.test",
});

export const app: AnyCrust = new Crust("acme").extend(acme.extension);
