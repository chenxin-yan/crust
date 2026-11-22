import { AuthError, createAuth } from "@crustjs/auth";
import {
	type AccessToken,
	createAuthorizationSession,
	createTokenClient,
	createTokenSource,
	credentialStore,
	defineServers,
	deviceCodeMessage,
	discover,
	openBrowser,
	startDeviceFlow,
} from "@crustjs/auth/oauth";
import { apiCommand, type BearerCredential, bearerAuth } from "@crustjs/openapi";

//#region client
const auth = createAuth({
	app: "acme",
	issuer: "https://login.acme.example",
	clientId: "acme-cli",
	apiOrigins: ["https://api.acme.example"],
	scope: "read",
	env: "ACME_TOKEN",
});

await auth.login({
	onUrl: async ({ url, open }) => {
		console.error(`Sign in at: ${url}`);
		await open();
	},
	onCode: ({ message }) => console.error(message),
});
//#endregion

//#region token
// The env variable's value, else the stored login, refreshed first when it is about to expire.
const token = await auth.token({ baseUrl: "https://api.acme.example" });
await fetch("https://api.acme.example/me", { headers: { authorization: `Bearer ${token.value}` } });

// "env", "login" or "none": no request, no refresh, no lock.
const { source, expiresAt } = await auth.status();

// Deletes the login, then revokes it at the server.
const loggedOut = await auth.logout();
//#endregion

//#region openapi
const api = apiCommand({
	spec: { openapi: "3.1.0", info: { title: "Acme", version: "1" }, paths: {} },
	baseUrl: "https://api.acme.example",
	// Resolved on the first authenticated request; a 401 refreshes a stored login once.
	auth: bearerAuth(auth.token),
});
//#endregion

//#region errors
try {
	await auth.token();
} catch (error) {
	if (error instanceof AuthError && error.code === "login-required") {
		console.error("Not signed in. Run `acme login`, or set ACME_TOKEN.");
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
	// No baseUrl: the user-info address is on the issuer, not one of apiOrigins.
	const { value: accessToken } = await auth.token();
	const response = await fetch(server.userinfoEndpoint, {
		headers: { authorization: `Bearer ${accessToken}` },
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

//#region blocks-openapi
const blocksApi = apiCommand({
	spec: { openapi: "3.1.0", info: { title: "Acme", version: "1" }, paths: {} },
	baseUrl: "https://api.acme.example",
	auth: bearerAuth(async ({ signal, baseUrl }) => {
		const credential = (stored: AccessToken): BearerCredential => ({
			value: stored.value,
			refresh: async (options) =>
				credential(
					await acme.forceRefresh({ ...options, ifGeneration: stored.generation, baseUrl }),
				),
		});
		return credential(await acme.get({ signal, baseUrl }));
	}),
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

console.log(source, expiresAt, loggedOut, api, multi, dev, local, remote, blocksApi);
