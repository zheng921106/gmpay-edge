import type { LucideIcon } from "lucide-react";
import {
	ArrowUpRight,
	BookOpen,
	CheckCircle2,
	Code2,
	Download,
	Layers3,
	ShieldCheck,
	Webhook,
} from "lucide-react";
import { MerchantGuide } from "#/features/docs/merchant-guide";
import { m } from "#/paraglide/messages";

type DocsNavItem = {
	icon: LucideIcon;
	id: string;
	label: string;
};

const docsNavItems = (): DocsNavItem[] => [
	{ id: "quick-start", label: m.docs_workspace_quick_start(), icon: BookOpen },
	{ id: "gmpay", label: m.docs_workspace_gmpay(), icon: Code2 },
	{ id: "epay", label: m.docs_workspace_epay(), icon: Layers3 },
	{
		id: "reliability",
		label: m.docs_workspace_reliability(),
		icon: Webhook,
	},
	{
		id: "launch-checklist",
		label: m.docs_workspace_go_live(),
		icon: CheckCircle2,
	},
];

function CapabilityStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="border-l border-border/70 pl-4 first:border-l-0 first:pl-0">
			<p className="text-2xl font-semibold tracking-tight text-foreground">
				{value}
			</p>
			<p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</p>
		</div>
	);
}

export function ApiReferenceClientPage() {
	const navItems = docsNavItems();

	return (
		<main
			className="container px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
			data-docs-workspace
		>
			<header className="border-b border-border/80 pb-8 sm:pb-10">
				<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
					<div className="max-w-3xl">
						<p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
							{m.docs_workspace_eyebrow()}
						</p>
						<h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
							{m.docs_workspace_title()}
						</h1>
						<p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
							{m.docs_workspace_description()}
						</p>
						<div className="mt-6 flex flex-wrap items-center gap-3">
							<a
								className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
								data-docs-download
								download="together9-openapi.yaml"
								href="/openapi.yaml"
							>
								<Download aria-hidden="true" className="size-4" />
								{m.docs_workspace_download()}
							</a>
							<a
								className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
								href="#quick-start"
							>
								<BookOpen aria-hidden="true" className="size-4" />
								{m.docs_workspace_quick_start()}
							</a>
						</div>
					</div>

					<div className="border-l border-primary/40 pl-5 lg:mb-1">
						<div className="flex items-center gap-2 text-sm font-medium text-foreground">
							<ShieldCheck aria-hidden="true" className="size-4 text-primary" />
							{m.docs_workspace_download_note()}
						</div>
						<div className="mt-6 grid grid-cols-3 gap-4">
							<CapabilityStat label={m.docs_workspace_protocols()} value="2" />
							<CapabilityStat
								label={m.docs_workspace_environments()}
								value="2"
							/>
							<CapabilityStat
								label={m.docs_workspace_webhooks()}
								value="24/7"
							/>
						</div>
					</div>
				</div>
			</header>

			<div className="grid gap-10 pt-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
				<aside className="lg:sticky lg:top-24 lg:self-start" data-docs-sidebar>
					<p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
						{m.docs_workspace_on_this_page()}
					</p>
					<nav aria-label={m.docs_workspace_on_this_page()}>
						<ul className="space-y-1">
							{navItems.map(({ icon: Icon, id, label }) => (
								<li key={id}>
									<a
										className="group flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										href={`#${id}`}
									>
										<Icon aria-hidden="true" className="size-4 shrink-0" />
										<span className="min-w-0 truncate">{label}</span>
									</a>
								</li>
							))}
						</ul>
					</nav>
					<div className="mt-8 border-t border-border/70 pt-5">
						<p className="text-sm font-medium text-foreground">
							{m.docs_workspace_download()}
						</p>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							{m.docs_workspace_download_note()}
						</p>
						<a
							className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
							href="/openapi.yaml"
							target="_blank"
							rel="noreferrer"
						>
							openapi.yaml
							<ArrowUpRight aria-hidden="true" className="size-3.5" />
						</a>
					</div>
				</aside>

				<div className="min-w-0">
					<section
						className="scroll-mt-24 border-b border-border/80 pb-9"
						id="quick-start"
					>
						<div className="flex items-start gap-4">
							<span className="mt-1 font-mono text-xs font-semibold text-primary">
								01
							</span>
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
									{m.docs_workspace_quick_start()}
								</p>
								<h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
									{m.docs_workspace_quick_start_title()}
								</h2>
								<p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
									{m.docs_workspace_quick_start_description()}
								</p>
							</div>
						</div>
						<div className="mt-7 grid gap-3 sm:grid-cols-3">
							<div className="rounded-lg border border-border/80 bg-muted/25 p-4">
								<Code2 aria-hidden="true" className="size-4 text-primary" />
								<p className="mt-3 text-sm font-medium text-foreground">
									{m.docs_workspace_gmpay()}
								</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									HMAC-SHA256 · JSON / form
								</p>
							</div>
							<div className="rounded-lg border border-border/80 bg-muted/25 p-4">
								<Layers3 aria-hidden="true" className="size-4 text-primary" />
								<p className="mt-3 text-sm font-medium text-foreground">
									{m.docs_workspace_epay()}
								</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									MD5 · GET / form POST
								</p>
							</div>
							<div className="rounded-lg border border-border/80 bg-muted/25 p-4">
								<Webhook aria-hidden="true" className="size-4 text-primary" />
								<p className="mt-3 text-sm font-medium text-foreground">
									{m.docs_workspace_reliability()}
								</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									Signed · idempotent · retryable
								</p>
							</div>
						</div>
					</section>

					<section className="pt-9" aria-label={m.docs_merchant_guide_link()}>
						<MerchantGuide />
					</section>
				</div>
			</div>
		</main>
	);
}
