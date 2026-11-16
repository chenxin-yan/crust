import { AuthError, createAuth } from "@crustjs/auth";
import {
	createAuthorizationSession,
	createTokenClient,
	defineServers,
	deviceCodeMessage,
	discover,
	openBrowser,
	startDeviceFlow,
} from "@crustjs/auth/oauth";

//#region client
const auth = createAuth({
	app: "acme",
	issuer: "https://login.acme.example",
	clientId: "acme-cli",
	scope: "read",
});

await auth.login({
	onUrl: async ({ url, open }) => {
		console.error(`Sign in at: ${url}`);
		await open();
	},
	onCode: ({ message }) => console.error(message),
});
//#endregion

//#region errors
try {
	await auth.login({
		onUrl: ({ url }) => console.error(url),
		onCode: ({ message }) => console.error(message),
	});
} catch (error) {
	if (error instanceof AuthError && error.code === "login-requires-interaction") {
		console.error("Run `acme login --device` to sign in with a code.");
	} else throw error;
}
//#endregion

//#region config
const config = defineServers({
	servers: [{ issuer: "https://login.acme.example", clientId: "acme-cli" }],
});
const server = await discover(config, "https://login.acme.example");
const client = createTokenClient(server);
//#endregion

//#region browser
const session = await createAuthorizationSession(server, { scope: "read" });
try {
	console.error(`Sign in at: ${session.url}`);
	await openBrowser(session.url);
	const tokens = await session.wait(({ code }) => client.exchangeCode(session, code));
	console.error(`Signed in; access token expires at ${tokens.expiresAt ?? "an unknown time"}`);
} finally {
	session.close();
}
//#endregion

//#region device
const flow = await startDeviceFlow(server, { scope: "read" });
console.error(deviceCodeMessage({ app: "Acme", ...flow }));
const deviceTokens = await flow.poll();
//#endregion

//#region servers
const multi = defineServers({
	servers: [
		// Sends `iss` in authorization responses (its metadata says so): no path needed.
		{ issuer: "https://login.acme.example", clientId: "acme-cli" },
		// Sends no `iss`: give it a callback path registered with this server only.
		{
			issuer: "https://sso.partner.example",
			clientId: "acme-cli",
			redirectPath: "/partner/callback",
		},
	],
});
//#endregion

//#region dev
const dev = defineServers({
	servers: [{ issuer: "http://127.0.0.1:9000", clientId: "acme-cli", allowInsecureLoopback: true }],
});
//#endregion

console.log(deviceTokens.tokenType, multi, dev);
