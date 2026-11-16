import { describe, expect, it } from "vite-plus/test";

import { deviceCodeMessage, redactUrl, sanitizeDisplay } from "./display.ts";

describe("redactUrl", () => {
	it.each([
		["https://h/cb?code=SENTINEL&state=S", "https://h/cb?code=[REDACTED]&state=[REDACTED]"],
		["https://h/cb?%63ode=SENTINEL", "https://h/cb?code=[REDACTED]"],
		[
			"https://h/cb?token=SENTINEL&token=SENTINEL2&x=1",
			"https://h/cb?token=[REDACTED]&token=[REDACTED]&x=1",
		],
		[
			"https://h/?access_token=A&refresh_token=R&id_token=I&client_secret=C&code_verifier=V&device_code=D&assertion=X",
			"https://h/?access_token=[REDACTED]&refresh_token=[REDACTED]&id_token=[REDACTED]&client_secret=[REDACTED]&code_verifier=[REDACTED]&device_code=[REDACTED]&assertion=[REDACTED]",
		],
		["https://u:SENTINEL@h/#access_token=SENTINEL", "https://u:REDACTED@h/#[REDACTED]"],
		["not a url SENTINEL", "[REDACTED]"],
	])("SEC-K4 redacts %s", (url, expected) => {
		expect(redactUrl(url)).toBe(expected);
	});

	it("SEC-K4 never leaks a sentinel from random URLs", () => {
		const names = ["code", "state", "token", "a", "access_token", "%63ode", "refresh_token"];
		for (let index = 0; index < 500; index += 1) {
			const params = Array.from({ length: 1 + (index % 4) }, (_, n) => {
				const name = names[(index + n * 3) % names.length]!;
				return `${name}=${["code", "%63ode", "state", "token", "access_token", "refresh_token"].includes(name) ? "SENTINEL" : "v"}`;
			});
			expect(redactUrl(`https://h/p?${params.join("&")}`)).not.toContain("SENTINEL");
		}
	});
});

describe("sanitizeDisplay", () => {
	it("SEC-K5 removes escape sequences and C0/C1 controls", () => {
		const output = sanitizeDisplay("\x1b[31m\r\nFAKE PROMPT\x9b2J\x1b]8;;https://evil\x07X\tY\x7f");
		expect(output).toBe("FAKE PROMPTXY");
		// oxlint-disable-next-line no-control-regex -- asserting control characters are gone.
		expect(output).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
	});

	it("SEC-K5 truncates to 200 characters", () => {
		expect(sanitizeDisplay("x".repeat(500))).toHaveLength(200);
	});
});

describe("deviceCodeMessage", () => {
	it("SEC-D11 SEC-DEC-16 SEC-D7 shows the host, the code and the anti-phishing line", () => {
		const message = deviceCodeMessage({
			app: "Acme",
			userCode: "WDJB-MJHT",
			verificationUri: "https://login.acme.example/device",
		});
		expect(message).toContain("https://login.acme.example/device");
		expect(message).toContain("(host: login.acme.example)");
		expect(message).toContain("WDJB-MJHT");
		expect(message).toContain("Only continue if you started this sign-in yourself");
		expect(message).toContain("If anyone sent you this link or code, do not enter it.");
	});

	it("SEC-K5 sanitizes every value it prints", () => {
		const message = deviceCodeMessage({
			app: "Acme\x1b[2J",
			userCode: "AB\x1b[2JCD\nEF",
			verificationUri: "https://login.acme.example/device\r\nFAKE",
		});
		expect(message).toContain("ABCDEF");
		expect(message).not.toContain("\x1b");
		expect(message.split("\n")).toHaveLength(4);
	});
});
