import { describe, expect, it } from "vite-plus/test";

import { defaultGroup, defaultName, kebab } from "./names.ts";

describe("kebab", () => {
	it.each([
		["DeleteWebhook", "delete-webhook"],
		["deleteWebhook", "delete-webhook"],
		["notificationUrl", "notification-url"],
		["notification_url", "notification-url"],
		["Brand Protection", "brand-protection"],
		["brand_protection", "brand-protection"],
		["account_id", "account-id"],
		["zones-0-get", "zones-0-get"],
		["getHTTPResponse", "get-http-response"],
		["CAs", "c-as"],
		["AAGUIDs", "aagui-ds"],
		["  --x.y--  ", "x-y"],
		["日本", ""],
	])("%j → %j", (input, expected) => {
		expect(kebab(input)).toBe(expected);
	});
});

describe("defaultGroup", () => {
	it("is the kebab-cased first tag, or the root without tags", () => {
		expect(defaultGroup({ tags: ["DNS Records", "Zones"] })).toBe("dns-records");
		expect(defaultGroup({ tags: [] })).toBe("");
	});
});

describe("defaultName", () => {
	it("strips the group prefix only when a name remains", () => {
		expect(defaultName({ id: "usersList" }, "users")).toBe("list");
		expect(defaultName({ id: "users" }, "users")).toBe("users");
		expect(defaultName({ id: "dnsRecordsList" }, "dns records")).toBe("list");
		expect(defaultName({ id: "listUsers" }, "users")).toBe("list-users");
		expect(defaultName({ id: "usersList" }, "")).toBe("users-list");
		expect(defaultName({ id: "usersettingsGet" }, "user")).toBe("usersettings-get");
	});
});
