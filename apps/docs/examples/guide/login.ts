import { createAuth } from "@crustjs/auth";
import { defineCommand } from "@crustjs/core";
import { apiCommand, bearerAuth } from "@crustjs/openapi";

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
		.flags({ device: { type: "boolean", description: "Sign in with a code on another device" } })
		.action(({ flags, signal, stderr }) =>
			auth.login({
				device: flags.device,
				signal,
				onUrl: async ({ url, open }) => {
					stderr(`Sign in at: ${url}`);
					await open();
				},
				onCode: ({ message }) => stderr(message),
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

export const api = apiCommand({
	spec: { openapi: "3.1.0", info: { title: "Acme", version: "1" }, paths: {} },
	baseUrl: "https://api.acme.example",
	auth: bearerAuth(auth.token),
});
