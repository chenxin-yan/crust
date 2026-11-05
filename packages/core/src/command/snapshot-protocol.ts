import { BUILD_OUT_DIR_ENV } from "@crustjs/utils/artifacts";

import type { BuildReport } from "../api/extension.ts";
import type { ExtensionId } from "../identity.ts";
import { applyExtensionSections, type MaterializeCommandDefinition } from "./extensions-install.ts";
import { buildExtensionTree } from "./invocation.ts";
import { cloneCommandNode, type CommandNode } from "./node.ts";
import { snapshotCommand } from "./snapshot.ts";

function normalizeArtifactPath(path: string): string {
	const { posix, win32 } = process.getBuiltinModule("node:path");
	const normalized = posix.normalize(path.replaceAll("\\", "/"));
	const drivePrefix = /^[A-Za-z]:/;
	if (
		posix.isAbsolute(normalized) ||
		win32.isAbsolute(path) ||
		win32.isAbsolute(normalized) ||
		drivePrefix.test(path) ||
		drivePrefix.test(normalized)
	) {
		throw new Error(`Artifact path "${path}" must be relative to outDir.`);
	}
	if (normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Artifact path "${path}" escapes outDir.`);
	}
	if (normalized === "." || normalized === "./") {
		throw new Error(`Artifact path "${path}" must name a file inside outDir.`);
	}
	return normalized;
}

/** Write the Command Snapshot and, when a build output directory is set, Extension artifacts and the Build Report. */
export async function writeSnapshotProtocol(
	node: CommandNode,
	snapshotPath: string,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<void> {
	const { mkdir, writeFile } = process.getBuiltinModule("node:fs/promises");
	const { dirname, join } = process.getBuiltinModule("node:path");
	// Commands and flags materialize once so recipes keep their
	// once-per-`.add()` lifecycle; only section callbacks re-evaluate.
	const base = buildExtensionTree(node, materializeCommandDefinition);
	const takeSnapshot = () => {
		// Contributions are keyed by node, so each evaluation needs fresh nodes to
		// replace, rather than extend, the previous evaluation's sections.
		const root = cloneCommandNode(base.rootNode);
		applyExtensionSections(root, base.extensions);
		return snapshotCommand(root);
	};
	let snapshot = takeSnapshot();
	const buildOutDir = process.env[BUILD_OUT_DIR_ENV];
	if (buildOutDir) {
		const extensions: Array<BuildReport["extensions"][number]> = [];
		// Keyed case-insensitively: the tree may land on a case-insensitive filesystem
		// where `Config.json` and `config.json` are one file and the second write wins.
		const owners = new Map<string, { id: ExtensionId; path: string }>();
		for (const extension of base.extensions) {
			if (!extension.build) continue;
			try {
				const artifacts = await extension.build({ snapshot });
				// Every path is checked before any file is written, so a rejected hook leaves nothing behind.
				const files = artifacts.map((file) => {
					const path = normalizeArtifactPath(file.path);
					const key = path.toLowerCase();
					// A file and a directory cannot share a name, so an ancestor or descendant
					// of an owned path collides just like an equal one.
					for (const [ownedKey, owner] of owners) {
						if (
							ownedKey === key ||
							ownedKey.startsWith(`${key}/`) ||
							key.startsWith(`${ownedKey}/`)
						) {
							throw new Error(
								`Artifact path "${path}" collides with "${owner.path}" produced by Extension "${owner.id}".`,
							);
						}
					}
					owners.set(key, { id: extension.id, path });
					return { path, content: file.content };
				});
				// ponytail: in-memory files; stream if an extension ever ships large binaries
				for (const file of files) {
					const target = join(buildOutDir, file.path);
					await mkdir(dirname(target), { recursive: true });
					await writeFile(target, file.content);
				}
				extensions.push({ id: extension.id, files: files.map((file) => file.path) });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Extension "${extension.id}" build failed: ${message}`, {
					cause: error,
				});
			}
			// The hook sees the snapshot from before it starts; re-evaluating sections
			// after its files are on disk lets later hooks observe its outputs without
			// mutating the frozen tree.
			snapshot = takeSnapshot();
		}
		await writeFile(
			join(dirname(snapshotPath), "build-report.json"),
			JSON.stringify({ extensions } satisfies BuildReport),
		);
	}
	await writeFile(snapshotPath, JSON.stringify(snapshot));
}
