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
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#ff6a10",
              boxShadow: "0 0 8px rgba(255, 106, 16, 0.5)",
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
