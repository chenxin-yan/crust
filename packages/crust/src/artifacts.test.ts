import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { type ArtifactOwner, mergeEntryArtifacts } from "./artifacts.ts";

describe("mergeEntryArtifacts", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "crust-merge-artifacts-"));
	const artifactDir = join(tmpDir, "artifacts");
	const write = (path: string, content = "x\n") => {
		mkdirSync(join(tmpDir, path, ".."), { recursive: true });
		writeFileSync(join(tmpDir, path), content);
	};

	beforeEach(() => rmSync(tmpDir, { recursive: true, force: true }));
	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("merges distinct paths from every entry", () => {
		write("greet/man/greet.1", "greet man\n");
		write("greet/skills/greet/SKILL.md", "greet skill\n");
		write("admin/man/admin.1", "admin man\n");
		write("admin/skills/admin/SKILL.md", "admin skill\n");
		const owners = new Map<string, ArtifactOwner>();

		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);
		mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners);

		expect(readFileSync(join(artifactDir, "man", "greet.1"), "utf8")).toBe("greet man\n");
		expect(readFileSync(join(artifactDir, "man", "admin.1"), "utf8")).toBe("admin man\n");
		expect(readFileSync(join(artifactDir, "skills", "greet", "SKILL.md"), "utf8")).toBe(
			"greet skill\n",
		);
		expect(readFileSync(join(artifactDir, "skills", "admin", "SKILL.md"), "utf8")).toBe(
			"admin skill\n",
		);
		expect(owners.get("man")).toEqual({ command: "greet", directory: true, path: "man" });
		expect(owners.get("man/admin.1")).toEqual({
			command: "admin",
			directory: false,
			path: "man/admin.1",
		});
	});

	it("rejects a file two entries both write, naming both commands", () => {
		write("greet/completions/_shared");
		write("greet/man/greet.1");
		write("admin/man/greet.1", "overwrite attempt\n");
		const owners = new Map<string, ArtifactOwner>();
		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);

		expect(() => mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners)).toThrow(
			'Build artifact "man/greet.1" is written by both bin "greet" and "admin".',
		);
		expect(readFileSync(join(artifactDir, "man", "greet.1"), "utf8")).toBe("x\n");
	});

	it("rejects a directory in one entry that is a file in another", () => {
		write("greet/skills/tool");
		write("admin/skills/tool/SKILL.md");
		write("third/skills/tool");
		const owners = new Map<string, ArtifactOwner>();
		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);

		expect(() => mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners)).toThrow(
			'Build artifact "skills/tool" is written by both bin "greet" and "admin".',
		);
		rmSync(join(artifactDir, "skills", "tool"));
		owners.delete("skills/tool");
		mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners);
		expect(() => mergeEntryArtifacts(join(tmpDir, "third"), artifactDir, "third", owners)).toThrow(
			'Build artifact "skills/tool" is written by both bin "admin" and "third".',
		);
	});

	it.each(["file", "directory", "dangling"])(
		"rejects unexpected %s links without copying outside contents",
		(kind) => {
			write("outside/sentinel", "outside bytes");
			mkdirSync(join(tmpDir, "entry", "assets"), { recursive: true });
			const target =
				kind === "file" ? "outside/sentinel" : kind === "directory" ? "outside" : "missing";
			symlinkSync(
				join(tmpDir, target),
				join(tmpDir, "entry", "assets", "link"),
				kind === "directory" ? "dir" : "file",
			);
			expect(() =>
				mergeEntryArtifacts(join(tmpDir, "entry"), artifactDir, "legacy", new Map()),
			).toThrow(/regular files|symlink/);
			expect(existsSync(join(artifactDir, "assets", "link"))).toBe(false);
			expect(readFileSync(join(tmpDir, "outside", "sentinel"), "utf8")).toBe("outside bytes");
		},
	);

	it("rejects a replaced entry root without reading linked files", () => {
		write("outside/sentinel", "outside bytes");
		symlinkSync(join(tmpDir, "outside"), join(tmpDir, "entry"), "dir");
		expect(() =>
			mergeEntryArtifacts(join(tmpDir, "entry"), artifactDir, "legacy", new Map()),
		).toThrow(/symlink/);
		expect(existsSync(join(artifactDir, "sentinel"))).toBe(false);
		expect(readFileSync(join(tmpDir, "outside/sentinel"), "utf8")).toBe("outside bytes");
	});

	it.skipIf(process.platform === "win32")(
		"rejects nonregular socket entries without copying them",
		async () => {
			mkdirSync(join(tmpDir, "entry"), { recursive: true });
			const server = createServer();
			try {
				await new Promise<void>((resolve, reject) => {
					server.once("error", reject);
					server.listen(join(tmpDir, "entry/socket"), resolve);
				});
				expect(() =>
					mergeEntryArtifacts(join(tmpDir, "entry"), artifactDir, "legacy", new Map()),
				).toThrow(/regular files/);
				expect(existsSync(join(artifactDir, "socket"))).toBe(false);
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		},
	);

	it.each([
		["shared/Config.json", "shared/config.json"],
		["shared/Config", "shared/config/child"],
		["shared/Config/child", "shared/config"],
		["Shared/Config.json", "shared/config.json"],
		["Assets/a", "assets/b"],
		["shared/Assets/a", "shared/assets/b"],
	])("rejects portable cross-entry collision %s / %s", (first, second) => {
		write(`greet/${first}`);
		write(`admin/${second}`);
		const owners = new Map<string, ArtifactOwner>();
		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);
		expect(() => mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners)).toThrow(
			/both bin "greet" and "admin"/,
		);
		expect(readFileSync(join(artifactDir, first), "utf8")).toBe("x\n");
	});

	it("preserves bytes in identically spelled shared directories", () => {
		write("greet/shared/first");
		write("admin/shared/second");
		const bytes = new Uint8Array([0, 255, 128, 10]);
		writeFileSync(join(tmpDir, "admin/shared/second"), bytes);
		const owners = new Map<string, ArtifactOwner>();
		mergeEntryArtifacts(join(tmpDir, "greet"), artifactDir, "greet", owners);
		mergeEntryArtifacts(join(tmpDir, "admin"), artifactDir, "admin", owners);
		expect(new Uint8Array(readFileSync(join(artifactDir, "shared/second")))).toEqual(bytes);
	});

	it("tolerates an entry whose hooks wrote nothing", () => {
		mergeEntryArtifacts(join(tmpDir, "missing"), artifactDir, "greet", new Map());
		expect(existsSync(artifactDir)).toBe(false);
	});
});
