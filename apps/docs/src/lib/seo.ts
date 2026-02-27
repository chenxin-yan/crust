// Shared SEO configuration for CrustJS docs
import type { MetaDescriptor } from "@tanstack/react-router";
import type * as React from "react";

/**
 * TanStack Router's `head()` meta array is typed as React's HTMLMetaElement
 * props, but `MetaDescriptor` is a broader union that also covers `property`,
 * `title`, etc. — all supported at runtime. This type alias + single cast in
 * `buildPageMeta` keeps the workaround in one place.
 */
type HeadMeta = Array<React.JSX.IntrinsicElements["meta"]>;
type HeadScript = React.JSX.IntrinsicElements["script"];

export const siteConfig = {
  name: "CrustJS",
  siteName: "CrustJS CLI Framework",
  siteUrl: "https://crustjs.com",
  titleTemplate: (page?: string) =>
    page
      ? `${page} | CrustJS CLI Framework`
      : "CrustJS - TypeScript CLI Framework for Bun",
  defaultDescription:
    "A TypeScript-first, Bun-native CLI framework with composable modules.",
  twitterCard: "summary" as const,
  githubUrl: "https://github.com/chenxin-yan/crust",
  npmUrl: "https://www.npmjs.com/org/crustjs",
  discordUrl: "https://discord.gg/sQF8hdN6Ht",
};

/** Build absolute URL from a path */
export function absoluteUrl(path: string): string {
  return `${siteConfig.siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Generate standard meta tags for a page */
export function buildPageMeta({
  title,
  description,
  canonical,
  noindex,
}: {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
}) {
  const resolvedTitle = siteConfig.titleTemplate(title);
  const resolvedDescription = description ?? siteConfig.defaultDescription;
  const resolvedCanonical = canonical ? absoluteUrl(canonical) : undefined;
  const meta: Array<MetaDescriptor> = [
    { title: resolvedTitle },
    { name: "description", content: resolvedDescription },
    // Open Graph
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: siteConfig.siteName },
    { property: "og:title", content: resolvedTitle },
    { property: "og:description", content: resolvedDescription },
    // Twitter
    { name: "twitter:card", content: siteConfig.twitterCard },
    { name: "twitter:title", content: resolvedTitle },
    { name: "twitter:description", content: resolvedDescription },
  ];

  if (noindex) {
    meta.push({ name: "robots", content: "noindex, nofollow" });
  }

  const links: Array<{ rel: string; href: string }> = [];
  if (resolvedCanonical) {
    meta.push({ property: "og:url", content: resolvedCanonical });
    links.push({ rel: "canonical", href: resolvedCanonical });
  }

  return { meta: meta as unknown as HeadMeta, links };
}

/** JSON-LD structured data for the site root */
export function buildSiteJsonLd(): HeadScript[] {
  return [
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "CrustJS",
        url: siteConfig.siteUrl,
        logo: absoluteUrl("/favicon-96x96.png"),
        sameAs: [
          siteConfig.githubUrl,
          siteConfig.npmUrl,
          siteConfig.discordUrl,
        ],
      }),
    },
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: siteConfig.siteName,
        url: siteConfig.siteUrl,
        description: siteConfig.defaultDescription,
      }),
    },
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        name: "CrustJS",
        description: siteConfig.defaultDescription,
        url: siteConfig.siteUrl,
        codeRepository: siteConfig.githubUrl,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Bun",
        license: "https://opensource.org/licenses/MIT",
      }),
    },
  ];
}
