import { defineConfig } from "vite-plus";

// Workspace root: `vp lint` and `vp fmt` read only these blocks, wherever they
// run, so package-specific settings live in `overrides`. Per-package pack and
// task settings are in each package's vite.config.ts (see vite.shared.ts).
export default defineConfig({
	fmt: {
		useTabs: true,
		sortImports: true,
		sortPackageJson: false,
		ignorePatterns: [
			".changeset/",
			"**/CHANGELOG.md",
			".pi/",
			"**/tests/fixtures/",
			".worktrees/",
			"packages/create-crust/templates/base/tsconfig.json",
			"packages/create-crust/templates/base/src/cli.ts",
			"apps/docs/.source/",
			"apps/docs/src/routeTree.gen.ts",
		],
		overrides: [
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
			reportUnusedDisableDirectives: "deny",
		},
		plugins: ["unicorn", "typescript", "oxc", "import", "promise", "node"],
		jsPlugins: [
			{
				name: "anti-slop",
				specifier: "./tools/oxlint/anti-slop/index.ts",
			},
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
			"unicorn/no-new-array": "off",
			"unicorn/no-useless-fallback-in-spread": "off",
			"unicorn/no-useless-spread": "off",

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
			"typescript/no-unnecessary-type-assertion": "error",
			"typescript/no-unnecessary-type-parameters": "off",
			"typescript/restrict-template-expressions": "off",

			"import/no-cycle": "error",
			"promise/no-multiple-resolved": "error",
			"typescript/no-import-type-side-effects": "error",
			"oxc/bad-bitwise-operator": "error",
			"oxc/no-accumulating-spread": "error",

			"typescript/no-floating-promises": "error",
			"typescript/no-misused-promises": "error",
			"typescript/switch-exhaustiveness-check": [
				"error",
				{ considerDefaultExhaustiveForUnions: true },
			],

			"promise/always-return": "off",

			"anti-slop/no-array-filter-map": "error",
			"anti-slop/no-chained-type-assertions": "error",
			"anti-slop/no-known-value-widening": "error",
			"anti-slop/no-module-mocking": "error",
			"anti-slop/no-object-parameters": "error",
			"anti-slop/no-reduce-accumulator-copy": "error",
			"anti-slop/no-runtime-typeof": ["error", { allowInTypeGuards: true }],
			"anti-slop/no-unknown-parameters": ["error", { allowInBoundaryFunctions: true }],
			"anti-slop/no-unknown-returns": "error",
			"anti-slop/no-unknown-type-aliases": "error",
			"anti-slop/no-unsafe-dictionary-type": "error",
			"anti-slop/no-widen-then-assert": "error",
			"anti-slop/require-safety-comment-for-type-assertion": "error",

			"vite-plus/prefer-vite-plus-imports": "error",
		},
		ignorePatterns: [
			"**/node_modules/",
			"**/dist/",
			".changeset/",
			"**/CHANGELOG.md",
			".pi/",
			".worktrees/",
			"packages/create-crust/templates/base/",
			"apps/docs/.source/",
			"apps/docs/.vercel/",
			"apps/docs/src/routeTree.gen.ts",
		],
		overrides: [
			{
				files: [
					"**/*.test.ts",
					"**/*.test-d.ts",
					"**/*.test.tsx",
					"**/*.spec.ts",
					"**/*.spec.tsx",
					"tests/**/*.ts",
					"tests/**/*.tsx",
				],
				rules: {
					"eslint/no-new": "off",
					"eslint/no-shadow": "off",
					"typescript/unbound-method": "off",
					"typescript/await-thenable": "off",
					"anti-slop/require-safety-comment-for-type-assertion": "off",
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
			"lint:task": "vp lint",
			"format:task": "vp fmt --check",
		},
	},
	test: {
		// Root `vp test` runs these projects, each with its own vite.config.ts;
		// docs tests stay separate (`vp test` in apps/docs).
		projects: ["packages/*", "scripts", "tools"],
	},
});
