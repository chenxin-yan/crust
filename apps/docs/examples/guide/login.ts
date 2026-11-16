import { createAuth } from "@crustjs/auth";
import { defineCommand } from "@crustjs/core";

export const auth = createAuth({
	app: "acme",
	issuer: "https://login.acme.example",
	clientId: "acme-cli",
	scope: "read",
});

export const login = defineCommand("login", { description: "Sign in to Acme" }, (command) =>
	command
		.flags({ device: { type: "boolean", description: "Sign in with a code on another device" } })
		.action(async ({ flags, signal, stderr }) => {
			await auth.login({
				device: flags.device,
				signal,
				onUrl: async ({ url, open }) => {
					stderr(`Sign in at: ${url}`);
					await open();
				},
				onCode: ({ message }) => stderr(message),
			});
		}),
);
