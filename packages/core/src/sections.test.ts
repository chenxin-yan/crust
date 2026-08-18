import { describe, expect, it } from "bun:test";

import { sectionsFor } from "./sections.ts";
import type { CommandSection } from "./types.ts";

const universal = { title: "Universal", body: "Everywhere" } as const;

describe("sectionsFor", () => {
	it("includes untargeted sections for every consumer", () => {
		expect(sectionsFor([universal], "terminal")).toEqual([universal]);
	});

	it("includes only sections addressed to the requested consumer", () => {
		const section = { title: "Agent notes", body: "For agents", only: ["agent-docs"] } as const;
		expect(sectionsFor([section], "agent-docs")).toEqual([section]);
		expect(sectionsFor([section], "terminal")).toEqual([]);
	});

	it("excludes sections from an excepted consumer", () => {
		const section = { title: "Human notes", body: "For humans", except: ["agent-docs"] } as const;
		expect(sectionsFor([section], "terminal")).toEqual([section]);
		expect(sectionsFor([section], "agent-docs")).toEqual([]);
	});

	it("matches consumer ids after structured cloning", () => {
		const sections = structuredClone([
			{ title: "Agent notes", body: "For agents", only: ["agent-docs"] },
		]) as CommandSection[];
		expect(sectionsFor(sections, "agent-docs")).toEqual(sections);
	});
});
