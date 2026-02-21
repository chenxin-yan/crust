import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// GitHub repository configuration
export const gitConfig = {
  user: "chenxin-yan",
  repo: "crust",
  branch: "main",
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 4,
          }}
        >
          <img
            src="/favicon-96x96.png"
            alt="Crust logo"
            style={{
              width: 24,
              height: 24,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "'Saira Condensed', sans-serif",
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: 4,
              textTransform: "uppercase" as const,
            }}
          >
            Crust
          </span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
