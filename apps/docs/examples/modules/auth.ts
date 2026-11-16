import {
	createAuthorizationSession,
	createTokenClient,
	defineAuth,
	deviceCodeMessage,
	discover,
	openBrowser,
	startDeviceFlow,
} from "@crustjs/auth";

//#region config
const auth = defineAuth({
	servers: [{ issuer: "https://login.acme.example", clientId: "acme-cli" }],
});
const server = await discover(auth, "https://login.acme.example");
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
const tokens = await flow.poll();
//#endregion

//#region servers
const multi = defineAuth({
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
const dev = defineAuth({
	servers: [{ issuer: "http://127.0.0.1:9000", clientId: "acme-cli", allowInsecureLoopback: true }],
});
//#endregion

console.log(tokens.tokenType, multi, dev);
