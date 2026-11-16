import {
	createAuthorizationSession,
	createTokenClient,
	defineAuth,
	detectLoginMode,
	deviceCodeMessage,
	discover,
	LoginRequiresInteractionError,
	openBrowser,
	startDeviceFlow,
	type TokenSet,
} from "@crustjs/auth";
import { defineCommand } from "@crustjs/core";
import { spinner } from "@crustjs/progress";
import { confirm } from "@crustjs/prompts";
import { configDir, createStore } from "@crustjs/store";

const ISSUER = "https://login.acme.example";
const auth = defineAuth({ servers: [{ issuer: ISSUER, clientId: "acme-cli" }] });
const credentials = createStore({
	dirPath: configDir("acme"),
	name: "credentials",
	fields: { accessToken: { type: "string" }, refreshToken: { type: "string" } },
	strict: true,
});

export const login = defineCommand("login", { description: "Sign in to Acme" }, (command) =>
	command
		.flags({
			device: { type: "boolean", description: "Sign in with a code on another device" },
			browser: {
				type: "boolean",
				default: true,
				description: "Sign in with a browser on this machine",
			},
		})
		.action(async ({ flags, signal, stderr }) => {
			const mode = detectLoginMode({ device: flags.device, noBrowser: !flags.browser });
			if (mode === "refuse") {
				throw new LoginRequiresInteractionError(
					"acme login needs a terminal. Pass --device to sign in with a code, or set ACME_TOKEN.",
				);
			}
			const server = await discover(auth, ISSUER, { signal });
			const client = createTokenClient(server);
			let tokens: TokenSet;
			if (mode === "device") {
				const flow = await startDeviceFlow(server, { scope: "read", signal });
				stderr(deviceCodeMessage({ app: "Acme", ...flow }));
				tokens = await spinner({
					message: "Waiting for approval",
					task: () => flow.poll({ signal }),
				});
			} else {
				const session = await createAuthorizationSession(server, { scope: "read", signal });
				try {
					stderr(`Sign in at: ${session.url}`);
					if (await confirm({ message: "Open it in your browser?" }))
						await openBrowser(session.url);
					tokens = await spinner({
						message: "Waiting for the browser",
						task: () =>
							session.wait(({ code }) => client.exchangeCode(session, code, { signal }), {
								signal,
							}),
					});
				} finally {
					session.close();
				}
			}
			await credentials.patch(
				{ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
				{ signal },
			);
			stderr("Signed in to Acme");
		}),
);
