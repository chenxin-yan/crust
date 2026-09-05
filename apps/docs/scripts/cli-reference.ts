/** Read the first Markdown table beneath an exact heading for CLI parity checks. */
export function markdownTable(markdown: string, heading: string): string[][] {
  const lines = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "").split("\n");
  const start = lines.indexOf(heading);
  if (start !== -1) {
    const section = lines.slice(start + 1);
    const end = section.findIndex((line) => /^#{1,6} /.test(line));
    const body = end === -1 ? section : section.slice(0, end);
    const tableStart = body.findIndex((line) => line.startsWith("|"));
    const remainder = tableStart === -1 ? [] : body.slice(tableStart);
    const tableEnd = remainder.findIndex((line) => !line.startsWith("|"));
    const table = tableEnd === -1 ? remainder : remainder.slice(0, tableEnd);
    if (table.length >= 2 && /^\|[\s:|-]+\|$/.test(table[1])) {
      return table.slice(2).map((line) =>
        line
          .slice(1, line.lastIndexOf("|"))
          .split(/(?<!\\)\|/)
          .map((cell) => cell.trim().replaceAll("`", "").replaceAll("\\|", "|")),
      );
    }
  }
  throw new Error(`Missing CLI reference table under ${heading}`);
}
