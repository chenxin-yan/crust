// ────────────────────────────────────────────────────────────────────────────
// Editor — Edit text in the user's $VISUAL or $EDITOR for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess, shellQuote } from "@crustjs/utils/process";

import type { TerminalIO } from "../core/renderer.ts";
import { canPrompt, NonInteractiveError, resolvePromptIO } from "../core/renderer.ts";

/** Options for the {@link editor} prompt. */
export interface EditorOptions {
	/**
	 * Text the file starts with.
	 *
	 * @default ""
	 */
	readonly initial?: string | undefined;
	/**
	 * Name of the temporary file, such as `"message.md"`; editors choose syntax highlighting
	 * from its extension. A file name, not a path.
	 *
	 * @default "edit.txt"
	 */
	readonly filename?: string | undefined;
}

/**
 * Open the user's editor, `$VISUAL`, else `$EDITOR`, on a temporary file holding `initial`,
 * and resolve with the file's text once the editor exits. The shell runs the variable, as Git
 * does, so it may carry arguments (`code --wait`). The file is removed afterwards.
 *
 * @param options - Editor prompt configuration
 * @param io - Optional streams that decide {@link canPrompt}, and the cancellation signal. The
 * editor itself runs on the process's own terminal.
 * @returns The text of the file after the editor exits
 * @throws {NonInteractiveError} when {@link canPrompt} is `false`
 * @throws when neither variable is set, or the editor exits with a non-zero status
 * @throws `signal.reason` when the resolved signal aborts; the editor is stopped first
 *
 * @example
 * ```ts
 * const body = await editor({ initial: "# Title\n", filename: "issue.md" });
 * ```
 */
export async function editor(options: EditorOptions = {}, io?: TerminalIO): Promise<string> {
	const { signal } = resolvePromptIO(io);
	signal?.throwIfAborted();
	if (!canPrompt(io)) throw new NonInteractiveError();
	const command = process.env.VISUAL || process.env.EDITOR;
	if (!command) throw new Error("editor() needs $VISUAL or $EDITOR to name an editor.");

	const directory = await mkdtemp(join(tmpdir(), "crust-editor-"));
	try {
		const file = join(directory, options.filename ?? "edit.txt");
		await writeFile(file, options.initial ?? "");
		const quoted = process.platform === "win32" ? `"${file}"` : shellQuote(file);
		const { exitCode } = await runProcess(`${command} ${quoted}`, [], {
			shell: true,
			stdio: "inherit",
			signal,
		});
		if (exitCode !== 0) throw new Error(`The editor (${command}) exited with status ${exitCode}.`);
		return await readFile(file, "utf8");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
