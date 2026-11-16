import { AuthError, createAuth } from "@crustjs/auth";
import {
	createAuthorizationSession,
	createTokenClient,
	createTokenSource,
	credentialStore,
	defineServers,
	deviceCodeMessage,
	discover,
	fromEnv,
	fromStdin,
	fromStore,
	openBrowser,
	resolveCredential,
	startDeviceFlow,
} from "@crustjs/auth/oauth";
import { apiCommand, bearerAuth } from "@crustjs/openapi";

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

//#region userinfo
if (server.userinfoEndpoint) {
	const response = await fetch(server.userinfoEndpoint, {
		headers: { authorization: `Bearer ${deviceTokens.accessToken}` },
	});
	console.error(await response.json());
}
//#endregion

//#region credentials
const acme = createTokenSource({
	config,
	identity: {
		issuer: "https://login.acme.example",
		clientId: "acme-cli",
		// The only API origins this login's token is sent to.
		apiOrigins: ["https://api.acme.example"],
	},
	store: credentialStore({ app: "acme" }),
});

// In `acme login`, around the browser or device login:
const ticket = await acme.beginLogin();
try {
	await ticket.commit(deviceTokens);
} finally {
	ticket.cancel();
}

// Refreshed first when it is about to expire. Send it; never print or log it.
const { value } = await acme.get();
await fetch("https://api.acme.example/me", { headers: { authorization: `Bearer ${value}` } });

// In `acme logout`:
const { local, remote } = await acme.logout();
//#endregion

//#region resolve
const credential = await resolveCredential([
	fromStdin({ enabled: process.argv.includes("--token-stdin") }),
	fromEnv("ACME_TOKEN"),
	fromStore(acme),
]);
if (credential.shadowed.includes("store")) {
	console.error(`Using the token from ${credential.source}, not your login`);
}
//#endregion

//#region openapi
const api = apiCommand({
	spec: { openapi: "3.1.0", info: { title: "Acme", version: "1" }, paths: {} },
	baseUrl: "https://api.acme.example",
	// Resolved on the first authenticated request; a 401 refreshes a stored login once.
	auth: bearerAuth((options) =>
		resolveCredential([fromEnv("ACME_TOKEN"), fromStore(acme)], options),
	),
});
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

console.log(multi, dev, local, remote, api);
