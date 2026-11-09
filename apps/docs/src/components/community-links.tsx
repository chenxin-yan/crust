import { ArrowUpRightIcon, MapIcon } from "lucide-react";
import type { ReactNode } from "react";

import { DiscordIcon, roadmapUrl } from "@/lib/layout.shared";
import { siteConfig } from "@/lib/seo";

function Pill({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			className="group inline-flex items-center gap-2 rounded-full border bg-fd-card px-3.5 py-1.5 text-sm font-medium text-fd-muted-foreground no-underline transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground [&_svg]:size-4"
		>
			{icon}
			{children}
			<ArrowUpRightIcon className="opacity-50 transition-opacity group-hover:opacity-100" />
		</a>
	);
}

export function CommunityLinks() {
	return (
		<div className="not-prose mt-6 flex flex-wrap items-center gap-2">
			<Pill href={roadmapUrl} icon={<MapIcon />}>
				Roadmap
			</Pill>
			<Pill href={siteConfig.discordUrl} icon={<DiscordIcon />}>
				Discord
			</Pill>
		</div>
	);
}
