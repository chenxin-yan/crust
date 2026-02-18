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
      title: "Crust",
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
