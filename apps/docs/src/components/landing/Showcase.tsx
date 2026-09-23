import { Popup, PopupContent, PopupTrigger } from "fumadocs-twoslash/ui";
import type { Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { type JSX, useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

// Twoslash-annotated Shiki hast per snippet key, written by scripts/twoslash-landing.ts.
// Turbo runs that task before build, check:types and dev; on its own: `bun run twoslash:landing`.
import landingTwoslash from "@/generated/landing-twoslash.json";

import { FEATURES, type Line, type Runtime, RUNTIMES, SNIPPETS } from "./content";

// oxlint-disable-next-line import/no-unassigned-import -- Vite bundles the stylesheet as a side effect of the import; there is nothing to assign.
import "./showcase.css";

// SAFETY: the JSON is Shiki `codeToHast` output written by scripts/twoslash-landing.ts.
const HIGHLIGHTED = landingTwoslash as Partial<Record<string, Root>>;

// Twoslash emits <Popup>/<PopupContent>/<PopupTrigger> elements; map them to the real components.
const POPUP_COMPONENTS = { Popup, PopupContent, PopupTrigger };

const LAST = FEATURES.length - 1;
const pad = (index: number): string => String(index + 1).padStart(2, "0");

function Lines({ lines, runtime }: { lines: readonly Line[]; runtime: Runtime }) {
	return (
		<pre className="fn-showcase-lines">
			{lines.map((line, index) => {
				const prompt = line.kind === "run" || line.kind === "cmd";
				const text =
					line.kind === "run" ? `${runtime.run(line.file)} ${line.args}`.trimEnd() : line.text;
				return (
					<span
						key={index}
						className={`fn-showcase-line ${prompt ? "fn-showcase-line-cmd" : `fn-showcase-line-${line.kind}`}`}
					>
						{text || " "}
					</span>
				);
			})}
		</pre>
	);
}

function PlainCode({ code }: { code: string }) {
	return (
		<pre className="shiki">
			<code>
				{code.split("\n").map((line, index) => (
					<span key={index} className="line">
						{line}
					</span>
				))}
			</code>
		</pre>
	);
}

/** Twoslash popups are elements in the hast; map them to components while rendering. */
function Code({ code }: { code: Root }) {
	return <>{toJsxRuntime(code, { Fragment, jsx, jsxs, components: POPUP_COMPONENTS })}</>;
}

export default function Showcase(): JSX.Element {
	const [active, setActive] = useState(0);
	const [runtime, setRuntime] = useState(RUNTIMES[0]);
	const section = useRef<HTMLElement>(null);
	const rule = useRef<HTMLDivElement>(null);
	const panels = useRef<(HTMLElement | null)[]>([]);

	useEffect(() => {
		let frame = 0;
		const update = () => {
			frame = 0;
			const host = section.current;
			if (!host) return;
			const viewport = window.innerHeight;
			// Progress: how much of the section has scrolled past, 0 at its top, 1 when its end reaches the bottom.
			const bounds = host.getBoundingClientRect();
			const distance = bounds.height - viewport;
			const progress = distance > 0 ? Math.min(1, Math.max(0, -bounds.top / distance)) : 1;
			// The rule is vertical beside the panels and horizontal when it becomes a bar; CSS reads the variable.
			if (rule.current) rule.current.style.setProperty("--fn-showcase-progress", String(progress));
			// Active: the panel whose centre is nearest the viewport centre.
			let nearest = 0;
			let best = Number.POSITIVE_INFINITY;
			panels.current.forEach((panel, index) => {
				if (!panel) return;
				const rect = panel.getBoundingClientRect();
				const gap = Math.abs(rect.top + rect.height / 2 - viewport / 2);
				if (gap < best) {
					best = gap;
					nearest = index;
				}
			});
			setActive(nearest);
		};
		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(update);
		};
		update();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
		};
	}, []);

	const feature = FEATURES[active];

	return (
		<section ref={section} className="fn-showcase" aria-label="Playground">
			{/* Pinned aside: the label column stays at eye level while the panels pass. */}
			<aside className="fn-showcase-head">
				<div ref={rule} className="fn-showcase-rule" aria-hidden="true" />
				{/* Keyed so a change fades the new name in instead of snapping. */}
				<div className="fn-showcase-title" key={feature.key} aria-live="polite">
					<span className="fn-showcase-counter">
						{pad(active)}
						<span className="fn-showcase-counter-total"> / {pad(LAST)}</span>
					</span>
					<h2 className="fn-showcase-name">{feature.tab}</h2>
					<p className="fn-showcase-claim">{feature.title}</p>
				</div>
			</aside>

			<ol className="fn-showcase-column">
				{FEATURES.map((item, index) => {
					const code = HIGHLIGHTED[item.code];
					return (
						<li
							key={item.key}
							className="fn-showcase-slot"
							data-active={index === active || undefined}
						>
							<article
								ref={(node) => {
									panels.current[index] = node;
								}}
								className="fn-showcase-panel"
							>
								<div className="fn-showcase-code">
									<div className="fn-showcase-header">
										<span>{item.file}</span>
										<span>{item.lang}</span>
									</div>
									<div className="fn-showcase-body fn-showcase-shiki">
										{code === undefined ? (
											<PlainCode code={SNIPPETS[item.code]} />
										) : (
											<Code code={code} />
										)}
									</div>
								</div>
								<div className="fn-showcase-output">
									<div className="fn-showcase-header fn-showcase-header-end">
										{/* Runtime picker: the `$` lines change, the output does not. */}
										<div className="fn-showcase-runtime" role="group" aria-label="Runtime">
											{RUNTIMES.map((option) => (
												<button
													key={option.key}
													type="button"
													className="fn-showcase-runtime-option"
													aria-pressed={option.key === runtime.key}
													onClick={() => setRuntime(option)}
												>
													{option.label}
												</button>
											))}
										</div>
									</div>
									<div className="fn-showcase-body">
										<Lines lines={item.output} runtime={runtime} />
									</div>
								</div>
							</article>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
