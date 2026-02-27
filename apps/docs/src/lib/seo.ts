// Shared SEO configuration for CrustJS docs
import type { MetaDescriptor } from "@tanstack/react-router";

export const siteConfig = {
  name: "CrustJS",
  siteName: "CrustJS CLI Framework",
  siteUrl: "https://crustjs.com",
  titleTemplate: (page?: string) =>
    page
      ? `${page} | CrustJS CLI Framework`
      : "CrustJS - TypeScript CLI Framework for Bun",
  defaultDescription:
    "A TypeScript-first, Bun-native CLI framework with composable modules. Zero dependencies, full type inference, middleware plugins.",
  ogImage: "/og/crustjs-cli.png",
  twitter: {
    card: "summary_large_image" as const,
  },
  github: {
    url: "https://github.com/chenxin-yan/crust",
    user: "chenxin-yan",
    repo: "crust",
  },
  npm: {
    scope: "@crustjs",
    url: "https://www.npmjs.com/org/crustjs",
  },
  discord: "https://discord.gg/sQF8hdN6Ht",
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
  const resolvedOgImage = absoluteUrl(siteConfig.ogImage);

  const meta: Array<MetaDescriptor> = [
    { title: resolvedTitle },
    { name: "description", content: resolvedDescription },
    // Open Graph
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: siteConfig.siteName },
    { property: "og:title", content: resolvedTitle },
    { property: "og:description", content: resolvedDescription },
    { property: "og:image", content: resolvedOgImage },
    // Twitter
    { name: "twitter:card", content: siteConfig.twitter.card },
    { name: "twitter:title", content: resolvedTitle },
    { name: "twitter:description", content: resolvedDescription },
    { name: "twitter:image", content: resolvedOgImage },
  ];

  if (noindex) {
    meta.push({ name: "robots", content: "noindex, nofollow" });
  }

  const links: Array<{ rel: string; href: string }> = [];
  if (resolvedCanonical) {
    meta.push({ property: "og:url", content: resolvedCanonical });
    links.push({ rel: "canonical", href: resolvedCanonical });
  }

  return { meta, links };
}

/** JSON-LD for the site root (Organization + WebSite + SoftwareSourceCode) */
export function buildSiteJsonLd(): Array<MetaDescriptor> {
  return [
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "CrustJS",
        url: siteConfig.siteUrl,
        logo: absoluteUrl("/favicon-96x96.png"),
        sameAs: [siteConfig.github.url, siteConfig.npm.url, siteConfig.discord],
      },
    },
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: siteConfig.siteName,
        url: siteConfig.siteUrl,
        description: siteConfig.defaultDescription,
      },
    },
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        name: "CrustJS",
        description: siteConfig.defaultDescription,
        url: siteConfig.siteUrl,
        codeRepository: siteConfig.github.url,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Bun",
        license: "https://opensource.org/licenses/MIT",
      },
    },
  ];
}
