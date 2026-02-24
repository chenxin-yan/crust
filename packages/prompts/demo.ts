// ────────────────────────────────────────────────────────────────────────────
// Interactive demo script for @crustjs/prompts
// Run: bun packages/prompts/demo.ts
// ────────────────────────────────────────────────────────────────────────────

import {
	confirm,
	filter,
	input,
	multiselect,
	password,
	select,
	spinner,
} from "./src/index.ts";

async function main() {
	console.log("\n=== @crustjs/prompts Demo ===\n");

	// ── 1. Input ────────────────────────────────────────────────────────────
	const name = await input({
		message: "What is your name?",
		placeholder: "Enter your name",
		validate: (v) => v.length > 0 || "Name cannot be empty",
	});
	console.log(`  -> Name: ${name}\n`);

	// ── 2. Input with default ──────────────────────────────────────────────
	const project = await input({
		message: "Project name?",
		default: "my-app",
		placeholder: "Enter project name",
	});
	console.log(`  -> Project: ${project}\n`);

	// ── 3. Password ────────────────────────────────────────────────────────
	const secret = await password({
		message: "Enter a secret password:",
		validate: (v) => v.length >= 4 || "Password must be at least 4 characters",
	});
	console.log(`  -> Password length: ${secret.length}\n`);

	// ── 4. Confirm ─────────────────────────────────────────────────────────
	const shouldContinue = await confirm({
		message: "Do you want to continue?",
	});
	console.log(`  -> Continue: ${shouldContinue}\n`);

	if (!shouldContinue) {
		console.log("Bye!");
		return;
	}

	// ── 5. Confirm (custom labels) ─────────────────────────────────────────
	const accepted = await confirm({
		message: "Accept the license agreement?",
		active: "Accept",
		inactive: "Decline",
		default: false,
	});
	console.log(`  -> Accepted: ${accepted}\n`);

	// ── 6. Select ──────────────────────────────────────────────────────────
	const color = await select({
		message: "Pick your favorite color",
		choices: ["Red", "Green", "Blue", "Yellow", "Purple"],
	});
	console.log(`  -> Color: ${color}\n`);

	// ── 7. Select (with objects + hints) ───────────────────────────────────
	const framework = await select({
		message: "Choose a framework",
		choices: [
			{ label: "React", value: "react", hint: "popular" },
			{ label: "Vue", value: "vue", hint: "progressive" },
			{ label: "Svelte", value: "svelte", hint: "compiled" },
			{ label: "Solid", value: "solid", hint: "reactive" },
			{ label: "Angular", value: "angular" },
		],
		default: "react",
	});
	console.log(`  -> Framework: ${framework}\n`);

	// ── 8. Multiselect ─────────────────────────────────────────────────────
	const toppings = await multiselect({
		message: "Select pizza toppings",
		choices: [
			"Cheese",
			"Pepperoni",
			"Mushrooms",
			"Olives",
			"Onions",
			"Peppers",
			"Pineapple",
		],
		required: true,
	});
	console.log(`  -> Toppings: ${toppings.join(", ")}\n`);

	// ── 9. Multiselect (with constraints) ──────────────────────────────────
	const features = await multiselect({
		message: "Enable features (pick 1-3)",
		choices: [
			{ label: "TypeScript", value: "ts", hint: "recommended" },
			{ label: "ESLint", value: "eslint" },
			{ label: "Prettier", value: "prettier" },
			{ label: "Tailwind CSS", value: "tailwind" },
			{ label: "Testing", value: "testing" },
		],
		default: ["ts"],
		min: 1,
		max: 3,
	});
	console.log(`  -> Features: ${features.join(", ")}\n`);

	// ── 10. Filter ─────────────────────────────────────────────────────────
	const language = await filter({
		message: "Search for a programming language",
		choices: [
			"TypeScript",
			"JavaScript",
			"Rust",
			"Python",
			"Go",
			"Java",
			"C++",
			"C#",
			"Ruby",
			"Swift",
			"Kotlin",
			"Dart",
			"Elixir",
			"Haskell",
			"Scala",
		],
		placeholder: "Type to filter...",
	});
	console.log(`  -> Language: ${language}\n`);

	// ── 11. Spinner ────────────────────────────────────────────────────────
	const data = await spinner({
		message: "Simulating some work...",
		task: async () => {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			return { status: "done", items: 42 };
		},
	});
	console.log(`  -> Spinner result: ${JSON.stringify(data)}\n`);

	// ── 12. Spinner (different style) ──────────────────────────────────────
	await spinner({
		message: "Almost there...",
		task: async () => {
			await new Promise((resolve) => setTimeout(resolve, 1500));
		},
		spinner: "arc",
	});

	// ── Summary ────────────────────────────────────────────────────────────
	console.log("\n=== Demo Complete ===");
	console.log(`  Name:      ${name}`);
	console.log(`  Project:   ${project}`);
	console.log(`  Color:     ${color}`);
	console.log(`  Framework: ${framework}`);
	console.log(`  Toppings:  ${toppings.join(", ")}`);
	console.log(`  Features:  ${features.join(", ")}`);
	console.log(`  Language:  ${language}`);
	console.log("");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
