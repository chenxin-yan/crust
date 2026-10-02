import { pageSchema } from "fumadocs-core/source/schema";

import { isPackageSlug, MODULE_PACKAGES, PACKAGE_GROUPS, PACKAGES } from "./src/lib/packages.ts";

// `modules/<slug>.mdx` or `modules/<slug>/index.mdx`; the slug is only a package page if PACKAGES has it.
const MODULE_PAGE = /\/modules\/([^/]+?)(?:\/index)?\.mdx$/;

/** Package pages take their description from package.json; a frontmatter copy is rejected so it cannot drift. */
export function packagePageSchema({ path }: { path: string }) {
	const slug = MODULE_PAGE.exec(path)?.[1];
	const description =
		slug !== undefined && isPackageSlug(slug) ? PACKAGES[slug].description : undefined;
	return pageSchema.transform((frontmatter, ctx) => {
		if (description === undefined) return frontmatter;
		if (frontmatter.description !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["description"],
				message: "package pages take their description from package.json",
			});
		}
		return { ...frontmatter, description };
	});
}

/** The mdast subtree, typed only as far as remarkPackageTable reads and writes it. */
export interface MdastNode {
	type: string;
	name?: string | null;
	attributes?: { type: string; name?: string; value?: string | { type: string } | null }[];
	position?: { start: { line: number; column: number } };
	children?: MdastNode[];
	value?: string;
	url?: string;
	align?: null[];
}

const tableCell = (...children: MdastNode[]): MdastNode => ({ type: "tableCell", children });
const tableText = (value: string): MdastNode => ({ type: "text", value });

/** Expands top-level `<PackageTable group="..." />` into a Markdown table, so search and llms.txt see the rows too. */
export function remarkPackageTable() {
	return (tree: MdastNode, file: { path: string }) => {
		tree.children = tree.children?.map((node) => {
			if (node.type !== "mdxJsxFlowElement" || node.name !== "PackageTable") return node;
			const location = node.position
				? `${file.path}:${node.position.start.line}:${node.position.start.column}`
				: file.path;
			const value = node.attributes?.find((attribute) => attribute.name === "group")?.value;
			const group = PACKAGE_GROUPS.find((candidate) => candidate === value);
			if (group === undefined) {
				throw new Error(
					`${location} from <PackageTable>: unknown group ${JSON.stringify(value)}, expected one of ${PACKAGE_GROUPS.join(", ")}`,
				);
			}
			const packages = MODULE_PACKAGES.filter((pkg) => pkg.group === group);
			if (packages.length === 0) {
				throw new Error(`${location} from <PackageTable>: group "${group}" has no packages`);
			}
			for (const pkg of packages) {
				if (!pkg.description) {
					throw new Error(
						`${location} from <PackageTable>: ${pkg.name} has no package.json description`,
					);
				}
			}
			return {
				type: "table",
				align: [null, null],
				children: [
					{
						type: "tableRow",
						children: [tableCell(tableText("Module")), tableCell(tableText("Description"))],
					},
					...packages.map((pkg) => ({
						type: "tableRow",
						children: [
							tableCell({
								type: "link",
								url: `/docs/modules/${pkg.slug}`,
								children: [{ type: "inlineCode", value: pkg.name }],
							}),
							tableCell(tableText(pkg.description)),
						],
					})),
				],
			};
		});
	};
}
