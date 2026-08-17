import { describe, expect, it } from "bun:test";

import { sectionsFor } from "./sections.ts";
import type { CommandSection } from "./types.ts";

const universal = { title: "Universal", body: "Everywhere" } as const;

describe("sectionsFor", () => {
	it("includes untargeted sections for every consumer", () => {
		expect(sectionsFor([universal], "help")).toEqual([universal]);
	});

	it("includes only sections addressed to the requested consumer", () => {
		const section = { title: "Agent notes", body: "For agents", only: ["skills"] } as const;
		expect(sectionsFor([section], "skills")).toEqual([section]);
		expect(sectionsFor([section], "help")).toEqual([]);
	});

	it("excludes sections from an excepted consumer", () => {
		const section = { title: "Human notes", body: "For humans", except: ["skills"] } as const;
		expect(sectionsFor([section], "help")).toEqual([section]);
		expect(sectionsFor([section], "skills")).toEqual([]);
	});

	it("matches consumer ids after structured cloning", () => {
		const sections = structuredClone([
			{ title: "Agent notes", body: "For agents", only: ["skills"] },
		]) as CommandSection[];
		expect(sectionsFor(sections, "skills")).toEqual(sections);
	});
});
