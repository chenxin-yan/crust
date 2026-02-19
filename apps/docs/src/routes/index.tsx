import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useCallback, useState } from "react";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import langTypescript from "shiki/langs/typescript.mjs";
import gruvboxDarkHard from "shiki/themes/gruvbox-dark-hard.mjs";
import gruvboxLightHard from "shiki/themes/gruvbox-light-hard.mjs";
import { baseOptions } from "@/lib/layout.shared";

const getHighlightedCode = createServerFn({ method: "GET" }).handler(
  async () => {
    const highlighter = await createHighlighterCore({
      themes: [gruvboxLightHard, gruvboxDarkHard],
      langs: [langTypescript],
      engine: createJavaScriptRegexEngine(),
    });
    const html = highlighter.codeToHtml(CODE_EXAMPLE, {
      lang: "typescript",
      themes: {
        light: "gruvbox-light-hard",
        dark: "gruvbox-dark-hard",
      },
      defaultColor: false,
    });
    highlighter.dispose();
    return html;
  },
);

export const Route = createFileRoute("/")({
  component: FurnaceHome,
  loader: async () => {
    const highlightedCode = await getHighlightedCode();
    return { highlightedCode };
  },
});

const FEATURES = [
  { id: "type-safe", title: "Type-Safe", desc: "Full inference. Zero casts." },
  { id: "zero-deps", title: "Zero Deps", desc: "No runtime dependencies." },
  { id: "composable", title: "Composable", desc: "Modular packages." },
  { id: "plugins", title: "Plugins", desc: "Middleware-based hooks." },
  { id: "declarative", title: "Declarative", desc: "Commands as objects." },
  { id: "bun-native", title: "Bun Native", desc: "Built for Bun runtime." },
];

const MODULES: Array<{
  pkg: string;
  desc: string;
  doc: string;
  upcoming?: boolean;
}> = [
  {
    pkg: "@crustjs/crust",
    desc: "Full bundle + CLI",
    doc: "modules/crust",
  },
  {
    pkg: "@crustjs/core",
    desc: "Parsing, routing, plugins",
    doc: "modules/core",
  },
  {
    pkg: "@crustjs/plugins",
    desc: "Official plugins for crust",
    doc: "modules/plugins",
  },
  {
    pkg: "@crustjs/validate",
    desc: "Input validation and coercion",
    doc: "modules/validate",
    upcoming: true,
  },
  {
    pkg: "@crustjs/prompt",
    desc: "Interactive prompts",
    doc: "modules/prompt",
    upcoming: true,
  },
  {
    pkg: "@crustjs/color",
    desc: "Terminal styling and colors",
    doc: "modules/color",
    upcoming: true,
  },
];

const CODE_EXAMPLE = `import { defineCommand, runMain } from "@crustjs/crust";

const cli = defineCommand({
  meta: { name: "greet" },
  args: { name: { type: String, default: "world" } },
  flags: { shout: { type: Boolean, alias: "s" } },
  run({ args, flags }) {
    const msg = \`Hello, \${args.name}!\`;
    console.log(flags.shout ? msg.toUpperCase() : msg);
  },
});

runMain(cli);`;

function FurnaceHome() {
  const { highlightedCode } = Route.useLoaderData();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText("bun create crust my-cli");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <>
      <style>{`
        /* ── Light mode (warm parchment) ─────────────────────────────── */
        :root {
          --fn-bg: #f5f0eb;
          --fn-surface: #ebe5de;
          --fn-primary: #1a1410;
          --fn-dim: #8a7a68;
          --fn-molten: #d45400;
          --fn-hot: #c04800;
          --fn-cool: #6a5848;
          --fn-border: #d8d0c6;
          --fn-glow-opacity: 0.04;
          --fn-grain-opacity: 0.004;
          --fn-string-color: #a85e00;
          --fn-btn-primary-text: #ffffff;
        }

        /* ── Dark mode (charred black + molten orange) ───────────────── */
        .dark {
          --fn-bg: #0c0806;
          --fn-surface: #161210;
          --fn-primary: #e8d8c8;
          --fn-dim: #6a5848;
          --fn-molten: #ff6a10;
          --fn-hot: #ffb848;
          --fn-cool: #c8c0b8;
          --fn-border: #2a2220;
          --fn-glow-opacity: 0.06;
          --fn-grain-opacity: 0.008;
          --fn-string-color: #d4a868;
          --fn-btn-primary-text: #0c0806;
        }

        .furnace-home {
          background: var(--fn-bg);
          color: var(--fn-primary);
          min-height: 100vh;
          font-family: 'Saira', sans-serif;
          overflow-x: clip;
          position: relative;
        }

        /* Subtle glow at top */
        .furnace-home::before {
          content: '';
          position: fixed;
          top: -100px;
          left: 50%;
          transform: translateX(-50%);
          width: 800px;
          height: 400px;
          background: radial-gradient(ellipse, rgba(255, 106, 16, var(--fn-glow-opacity)) 0%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }

        /* Fine grain overlay */
        .furnace-home::after {
          content: '';
          position: fixed;
          inset: 0;
          background:
            repeating-linear-gradient(
              0deg,
              transparent,
              transparent 2px,
              rgba(255, 106, 16, var(--fn-grain-opacity)) 2px,
              rgba(255, 106, 16, var(--fn-grain-opacity)) 3px
            );
          pointer-events: none;
          z-index: 0;
        }

        .fn-condensed {
          font-family: 'Saira Condensed', sans-serif;
        }

        .fn-mono {
          font-family: 'Fira Code', monospace;
        }

        /* Feature card */
        .fn-feature {
          background: var(--fn-surface);
          border: 1px solid var(--fn-border);
          border-top: 2px solid var(--fn-molten);
          padding: 20px;
          transition: all 0.25s;
          position: relative;
        }
        .fn-feature:hover {
          border-top-width: 4px;
          padding-top: 18px;
        }

        /* Install command — copy to clipboard */
        .fn-install-cmd {
          margin-top: 28px;
          padding: 12px 20px;
          background: var(--fn-surface);
          border: 1px solid var(--fn-border);
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: border-color 0.2s;
          position: relative;
          user-select: none;
          color: var(--fn-primary);
        }
        .fn-install-cmd:hover {
          border-color: var(--fn-dim);
        }
        .fn-install-cmd:active {
          border-color: var(--fn-molten);
        }

        /* Code block */
        .fn-code {
          background: var(--fn-surface);
          border: 1px solid var(--fn-border);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .fn-code-header {
          padding: 10px 16px;
          border-bottom: 1px solid var(--fn-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          color: var(--fn-dim);
          flex-shrink: 0;
        }
        .fn-code-body {
          padding: 3px 3px 3px 0;
          font-family: 'Fira Code', monospace;
          font-size: 12px;
          line-height: 1.65;
          overflow: hidden;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Shiki syntax highlighting */
        .fn-shiki-container .shiki {
          background: transparent !important;
          margin: 0;
          padding: 0;
          width: 100%;
          font-family: 'Fira Code', monospace;
          font-size: 12px;
          line-height: 1.65;
        }
        .fn-shiki-container .shiki code {
          font-family: inherit;
          counter-reset: line;
          display: flex;
          flex-direction: column;
        }
        .fn-shiki-container .shiki code .line {
          display: block;
        }
        .fn-shiki-container .shiki code .line::before {
          counter-increment: line;
          content: counter(line);
          display: inline-block;
          width: 20px;
          text-align: right;
          margin-right: 12px;
          color: var(--fn-dim);
          opacity: 0.5;
          font-size: 11px;
          user-select: none;
        }

        /* Dual-theme: light mode uses --shiki-light, dark uses --shiki-dark */
        .fn-shiki-container .shiki,
        .fn-shiki-container .shiki span {
          color: var(--shiki-light) !important;
          background-color: transparent !important;
        }
        .dark .fn-shiki-container .shiki,
        .dark .fn-shiki-container .shiki span {
          color: var(--shiki-dark) !important;
        }

        /* Buttons */
        .fn-btn-primary {
          background: var(--fn-molten);
          color: var(--fn-btn-primary-text);
          padding: 12px 32px;
          border: none;
          cursor: pointer;
          font-family: 'Saira Condensed', sans-serif;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 2px;
          text-transform: uppercase;
          transition: all 0.2s;
          text-decoration: none;
          display: inline-block;
        }
        .fn-btn-primary:hover {
          background: var(--fn-hot);
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(255, 106, 16, 0.4), 0 2px 8px rgba(255, 106, 16, 0.2);
        }
        .fn-btn-ghost {
          background: transparent;
          color: var(--fn-primary);
          padding: 12px 32px;
          border: 1px solid var(--fn-border);
          cursor: pointer;
          font-family: 'Saira Condensed', sans-serif;
          font-weight: 600;
          font-size: 14px;
          letter-spacing: 2px;
          text-transform: uppercase;
          transition: all 0.2s;
          text-decoration: none;
          display: inline-block;
        }
        .fn-btn-ghost:hover {
          border-color: var(--fn-dim);
        }

        /* Accent dot */
        .fn-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--fn-molten);
          display: inline-block;
          box-shadow: 0 0 8px rgba(255, 106, 16, 0.5);
        }

        /* Module row */
        .fn-module-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 0;
          border-bottom: 1px solid var(--fn-border);
          text-decoration: none;
          transition: all 0.2s;
        }
        .fn-module-row:hover {
          padding-left: 8px;
        }
        .fn-module-row:hover .fn-module-name {
          color: var(--fn-hot);
        }
        .fn-module-row:hover .fn-module-arrow {
          opacity: 1;
          transform: translateX(0);
        }
        .fn-module-arrow {
          opacity: 0;
          transform: translateX(-4px);
          transition: all 0.2s;
          color: var(--fn-molten);
          font-size: 14px;
        }

        /* Upcoming module row — not clickable */
        .fn-module-upcoming {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 0;
          border-bottom: 1px solid var(--fn-border);
          opacity: 0.5;
        }

        /* Coming soon badge */
        .fn-badge-soon {
          font-family: 'Saira Condensed', sans-serif;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--fn-dim);
          border: 1px solid var(--fn-border);
          padding: 2px 10px;
          white-space: nowrap;
        }

        /* Hero layout */
        .fn-hero-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 48px;
          align-items: stretch;
        }

        @media (max-width: 860px) {
          .fn-hero-grid {
            grid-template-columns: 1fr;
            gap: 32px;
          }
        }
      `}</style>

      <HomeLayout {...baseOptions()}>
        <div className="furnace-home">
          {/* Hero */}
          <section
            style={{
              padding: "80px 40px 80px",
              maxWidth: 1100,
              margin: "0 auto",
              position: "relative",
              zIndex: 2,
            }}
          >
            <p
              className="fn-mono"
              style={{
                fontSize: 11,
                letterSpacing: 4,
                color: "var(--fn-dim)",
                textTransform: "uppercase",
                marginBottom: 24,
              }}
            >
              CLI Framework {"/"} TypeScript {"/"} Bun
            </p>

            <div className="fn-hero-grid">
              {/* Left — text content */}
              <div>
                <h1
                  className="fn-condensed"
                  style={{
                    fontSize: "clamp(42px, 6vw, 80px)",
                    fontWeight: 800,
                    lineHeight: 0.95,
                    margin: 0,
                    letterSpacing: "-0.01em",
                    textTransform: "uppercase",
                  }}
                >
                  Build CLIs
                  <br />
                  <span
                    style={{ color: "var(--fn-molten)", whiteSpace: "nowrap" }}
                  >
                    with types.
                  </span>
                </h1>

                <p
                  style={{
                    fontSize: 16,
                    lineHeight: 1.7,
                    color: "var(--fn-dim)",
                    maxWidth: 420,
                    marginTop: 20,
                    fontWeight: 400,
                  }}
                >
                  A TypeScript-first, Bun-native CLI framework with composable
                  modules.
                </p>

                {/* Install — click to copy */}
                <button
                  type="button"
                  className="fn-mono fn-install-cmd"
                  onClick={handleCopy}
                >
                  <span style={{ color: "var(--fn-molten)" }}>{">"}</span>
                  <span>bun create crust my-cli</span>
                  <span
                    className="fn-mono"
                    style={{
                      fontSize: 10,
                      color: copied ? "var(--fn-molten)" : "var(--fn-dim)",
                      marginLeft: 8,
                      transition: "color 0.2s",
                      letterSpacing: 1,
                    }}
                  >
                    {copied ? "COPIED!" : "COPY"}
                  </span>
                </button>

                <div
                  style={{
                    marginTop: 20,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Link
                    to="/docs/$"
                    params={{ _splat: "quick-start" }}
                    className="fn-btn-primary"
                  >
                    Quick Start
                  </Link>
                  <Link
                    to="/docs/$"
                    params={{ _splat: "" }}
                    className="fn-btn-ghost"
                  >
                    Documentation
                  </Link>
                </div>
              </div>

              {/* Right — code sample */}
              <div className="fn-code">
                <div className="fn-code-header">
                  <span>src/cli.ts</span>
                  <span>TypeScript</span>
                </div>
                <div
                  className="fn-code-body fn-shiki-container"
                  dangerouslySetInnerHTML={{ __html: highlightedCode }}
                />
              </div>
            </div>
          </section>

          {/* Features */}
          <section
            style={{
              padding: "0 40px 64px",
              maxWidth: 1100,
              margin: "0 auto",
              position: "relative",
              zIndex: 2,
            }}
          >
            <p
              className="fn-mono"
              style={{
                fontSize: 10,
                letterSpacing: 4,
                color: "var(--fn-dim)",
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              Features
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
              }}
            >
              {FEATURES.map((f) => (
                <div key={f.id} className="fn-feature">
                  <h3
                    className="fn-condensed"
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      margin: "0 0 6px",
                      letterSpacing: 1,
                      textTransform: "uppercase",
                    }}
                  >
                    {f.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "var(--fn-dim)",
                      margin: 0,
                    }}
                  >
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Modules */}
          <section
            style={{
              padding: "0 40px 64px",
              maxWidth: 1100,
              margin: "0 auto",
              position: "relative",
              zIndex: 2,
            }}
          >
            <p
              className="fn-mono"
              style={{
                fontSize: 10,
                letterSpacing: 4,
                color: "var(--fn-dim)",
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              Modules
            </p>

            {MODULES.map((m) =>
              m.upcoming ? (
                <div key={m.pkg} className="fn-module-upcoming">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <code
                      className="fn-mono"
                      style={{
                        fontSize: 14,
                        color: "var(--fn-dim)",
                      }}
                    >
                      {m.pkg}
                    </code>
                    <span style={{ fontSize: 13, color: "var(--fn-dim)" }}>
                      {m.desc}
                    </span>
                  </div>
                  <span className="fn-badge-soon">Coming Soon</span>
                </div>
              ) : (
                <Link
                  key={m.pkg}
                  to="/docs/$"
                  params={{ _splat: m.doc }}
                  className="fn-module-row"
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <code
                      className="fn-mono fn-module-name"
                      style={{
                        fontSize: 14,
                        color: "var(--fn-molten)",
                        transition: "color 0.2s",
                      }}
                    >
                      {m.pkg}
                    </code>
                    <span style={{ fontSize: 13, color: "var(--fn-dim)" }}>
                      {m.desc}
                    </span>
                  </div>
                  <span className="fn-module-arrow">→</span>
                </Link>
              ),
            )}
          </section>

          {/* Footer */}
          <footer
            style={{
              padding: "20px 40px",
              borderTop: "1px solid var(--fn-border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              position: "relative",
              zIndex: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="fn-dot" />
              <span
                className="fn-condensed"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                }}
              >
                Crust
              </span>
            </div>
            <span
              style={{
                fontSize: 11,
                color: "var(--fn-dim)",
                letterSpacing: 1,
              }}
            >
              MIT
            </span>
          </footer>
        </div>
      </HomeLayout>
    </>
  );
}
