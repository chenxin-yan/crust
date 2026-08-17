import { describe, expect, it } from "bun:test";

import { defineSectionConsumer, sectionsFor } from "./sections.ts";
import type { CommandSection } from "./types.ts";

const help = defineSectionConsumer("help");
const man = defineSectionConsumer("man");
const skills = defineSectionConsumer("skills");

const universal = { title: "Universal", body: "Everywhere" } as const;

describe("defineSectionConsumer", () => {
	it("rejects empty consumer ids", () => {
		expect(() => defineSectionConsumer("")).toThrow("non-empty id");
		expect(() => defineSectionConsumer("   ")).toThrow("non-empty id");
	});
});

describe("sectionsFor", () => {
	it("includes untargeted sections for every consumer", () => {
		expect(sectionsFor([universal], help)).toEqual([universal]);
	});

	it("includes only sections addressed to a requested consumer", () => {
		const section = { title: "Agent notes", body: "For agents", only: [skills] } as const;
		expect(sectionsFor([section], skills)).toEqual([section]);
		expect(sectionsFor([section], help)).toEqual([]);
	});

	it("excludes sections from an excepted consumer", () => {
		const section = { title: "Human notes", body: "For humans", except: [skills] } as const;
		expect(sectionsFor([section], help)).toEqual([section]);
		expect(sectionsFor([section], skills)).toEqual([]);
	});

	it("uses any-of semantics for multiple consumers", () => {
		const skillOnly = { title: "Agent notes", body: "For agents", only: [skills] } as const;
		const exceptHelp = { title: "Not help", body: "Other output", except: [help] } as const;
		expect(sectionsFor([skillOnly, exceptHelp], help, man, skills)).toEqual([
			skillOnly,
			exceptHelp,
		]);
	});

	it("matches consumer ids after structured cloning", () => {
		const sections = structuredClone([
			{ title: "Agent notes", body: "For agents", only: [skills] },
		]) as CommandSection[];
		expect(sectionsFor(sections, defineSectionConsumer("skills"))).toEqual(sections);
	});
});
