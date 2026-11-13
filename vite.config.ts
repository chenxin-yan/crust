import { spawnSync } from "node:child_process";

import { defineConfig } from "vite-plus";

const sharedIgnorePatterns = [
	".changeset/",
	"**/CHANGELOG.md",
	".pi/",
	".worktrees/",
	"apps/docs/src/routeTree.gen.ts",
];

export default defineConfig({
	fmt: {
		useTabs: true,
		sortImports: true,
		sortPackageJson: false,
		ignorePatterns: [
			...sharedIgnorePatterns,
			"**/tests/fixtures/",
			"packages/create-crust/templates/base/package.json",
			"packages/create-crust/templates/base/tsconfig.json",
			"packages/create-crust/templates/base/src/cli.ts",
		],
		overrides: [
			{
				files: ["apps/docs/examples/landing/**"],
				options: {
					printWidth: 60,
				},
			},
			{
				files: ["apps/docs/**/*.{md,mdx,json,jsonc,yml,yaml}"],
				options: {
					useTabs: false,
					tabWidth: 2,
				},
			},
		],
	},
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
			reportUnusedDisableDirectives: "deny",
		},
		plugins: ["unicorn", "typescript", "oxc", "import", "promise", "node"],
		jsPlugins: [
			{
				name: "vite-plus",
				specifier: "vite-plus/oxlint-plugin",
			},
		],
		categories: {
			correctness: "error",
			suspicious: "error",
		},
		settings: {
			react: {
				version: "19.0",
			},
		},
		rules: {
			"eslint/no-underscore-dangle": "off",
			"eslint/no-restricted-properties": [
				"error",
				{
					object: "Reflect",
					property: "apply",
					message:
						"Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.",
				},
				{
					object: "Reflect",
					property: "get",
					message:
						"Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.",
				},
				{
					object: "Reflect",
					property: "set",
					message:
						"Replace `Reflect.set` with typed property assignment. Parse dynamic input into a named domain type before writing it.",
				},
			],
			"unicorn/no-array-sort": "off",
			"unicorn/consistent-function-scoping": "off",
			"typescript/no-unsafe-type-assertion": "off",
			"typescript/no-base-to-string": "off",
			"typescript/consistent-return": "off",
			"promise/always-return": "off",
			"typescript/no-unnecessary-type-parameters": "off",

			"import/no-cycle": "error",
			"typescript/no-import-type-side-effects": "error",
			"oxc/bad-bitwise-operator": "error",
			"oxc/no-accumulating-spread": "error",

			"typescript/no-misused-promises": "error",
			"typescript/switch-exhaustiveness-check": [
				"error",
				{ considerDefaultExhaustiveForUnions: true },
			],

			"vite-plus/prefer-vite-plus-imports": "error",
		},
		ignorePatterns: [...sharedIgnorePatterns, "packages/create-crust/templates/base/"],
		overrides: [
			{
				files: ["**/*.test.ts", "**/*.test-d.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
				rules: {
					"eslint/no-new": "off",
					"eslint/no-shadow": "off",
					"typescript/unbound-method": "off",
					// Type tests assert on `{}` results deliberately.
					"typescript/no-generated-empty-object-type": "off",
				},
			},
			{
				files: ["apps/docs/**"],
				plugins: ["react", "jsx-a11y"],
				env: {
					browser: true,
				},
				rules: {
					"react/react-in-jsx-scope": "off",
					"jsx-a11y/prefer-tag-over-role": "off",
				},
			},
		],
	},
	run: {
		tasks: {
			"check:task": "vp check",
		},
	},
	// `pnpm test` runs every project from here, so the tags below reach them all. A test file
	// opts into an extra CI host or a requirement with a `@module-tag` comment.
	test: {
		projects: ["packages/*", "scripts", "apps/docs"],
		tags: [
			{ name: "windows", description: "Also runs in the Windows CI job" },
			{ name: "macos", description: "Also runs in the macOS CI job" },
			{ name: "network", description: "Installs packages from a registry" },
			{
				name: "mise",
				description:
					"Runs the oldest supported Node.js or Bun through mise; skipped without mise outside CI",
				skip: !process.env.CI && spawnSync("mise", ["--version"], { stdio: "ignore" }).status !== 0,
			},
		],
	},
});
