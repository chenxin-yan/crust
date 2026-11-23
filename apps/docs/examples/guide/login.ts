import { createAuth } from "@crustjs/auth";
import { defineCommand } from "@crustjs/core";
import { bearerAuth, defineApi } from "@crustjs/openapi";

export const auth = createAuth({
	app: "acme",
	issuer: "https://login.acme.example",
	clientId: "acme-cli",
	apiOrigins: ["https://api.acme.example"],
	scope: "read",
	env: "ACME_TOKEN",
});

export const login = defineCommand("login", { description: "Sign in to Acme" }, (command) =>
	command
		.flags({
			device: { type: "boolean", description: "Sign in with a code on another device" },
			web: { type: "boolean", description: "Sign in with a browser" },
		})
		.action(({ flags, signal, stderr }) =>
			auth.login({
				flow: flags.device ? "device" : flags.web ? "browser" : "auto",
				signal,
				onUrl: async ({ url, open }) => {
					stderr(`Sign in at: ${url}`);
					await open();
				},
				onCode: ({ message }) => stderr(message),
				onWarning: () => stderr("No OS keyring found: your login is stored unencrypted."),
			}),
		),
);

export const logout = defineCommand("logout", { description: "Sign out of Acme" }, (command) =>
	command.action(({ signal }) => auth.logout({ signal })),
);

export const status = defineCommand("status", { description: "Show the sign-in" }, (command) =>
	command.action(async ({ stdout }) => {
		const { source } = await auth.status();
		stdout(source === "none" ? "Not signed in" : `Signed in (${source})`);
	}),
);

export const api = defineApi({
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.example",
}).auth(bearerAuth(auth.token));
