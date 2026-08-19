import { describe, expect, it } from "bun:test";

import { defineExtensionId } from "./identity.ts";
import { sectionsFor } from "./sections.ts";
import type { CommandSection } from "./types.ts";

const universal = { title: "Universal", body: "Everywhere" } as const;
const agentDocs = defineExtensionId("agent-docs");
const terminal = defineExtensionId("terminal");

describe("sectionsFor", () => {
	it("requires minted Extension ids in section audiences", () => {
		// @ts-expect-error section audiences reject raw strings
		const invalid: CommandSection = { title: "Invalid", body: "Invalid", only: ["raw"] };
		void invalid;
	});

	it("includes untargeted sections for every consumer", () => {
		expect(sectionsFor([universal], terminal)).toEqual([universal]);
	});

	it("includes only sections addressed to the requested consumer", () => {
		const section = { title: "Agent notes", body: "For agents", only: [agentDocs] } as const;
		expect(sectionsFor([section], agentDocs)).toEqual([section]);
		expect(sectionsFor([section], terminal)).toEqual([]);
	});

	it("excludes sections from an excepted consumer", () => {
		const section = { title: "Human notes", body: "For humans", except: [agentDocs] } as const;
		expect(sectionsFor([section], terminal)).toEqual([section]);
		expect(sectionsFor([section], agentDocs)).toEqual([]);
	});

	it("matches consumer ids after structured cloning", () => {
		const sections = structuredClone([
			{ title: "Agent notes", body: "For agents", only: [agentDocs] },
		]) as CommandSection[];
		expect(sectionsFor(sections, agentDocs)).toEqual(sections);
	});
});
