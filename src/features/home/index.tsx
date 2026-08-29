import { Link } from "@tanstack/react-router";
import {
	ArrowDownRight,
	ArrowRight,
	BadgeCheck,
	Blocks,
	Check,
	LockKeyhole,
	RadioTower,
	ShieldCheck,
	Webhook,
} from "lucide-react";
import { useSiteBrand } from "#/context/site-brand-provider";
import { m } from "#/paraglide/messages";

const confirmedBlockIds = Array.from(
	{ length: 20 },
	(_, index) => `confirmed-block-${index + 1}`,
);

export function HomePage() {
	const brand = useSiteBrand();
	const features = [
		{
			Icon: Blocks,
			index: "01",
			title: m.edge_home_feature_core(),
			text: m.edge_home_feature_core_description(),
		},
		{
			Icon: ShieldCheck,
			index: "02",
			title: m.edge_home_feature_security(),
			text: m.edge_home_feature_security_description(),
		},
		{
			Icon: Webhook,
			index: "03",
			title: m.edge_home_feature_webhooks(),
			text: m.edge_home_feature_webhooks_description(),
		},
	];
	const benefits = [
		m.edge_home_benefit_assets(),
		m.edge_home_benefit_amounts(),
		m.edge_home_benefit_states(),
		m.edge_home_benefit_api(),
	];

	return (
		<div className="overflow-hidden bg-[#0b0d0b] text-[#f5f4ed]">
			<section className="relative isolate overflow-hidden border-white/10 border-y">
				<HeroGrid />
				<div className="container relative flex min-h-[calc(100svh-4rem)] flex-col px-4 pt-20 pb-10 sm:pt-24 lg:pt-28">
					<div className="grid flex-1 items-center gap-14 py-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(31rem,1.1fr)] lg:gap-20">
						<div className="max-w-2xl">
							<p className="flex items-center gap-3 text-[#b6ff43] text-xs uppercase tracking-[0.18em]">
								<span className="relative flex size-2">
									<span className="absolute inline-flex size-full animate-ping rounded-full bg-[#b6ff43] opacity-60 motion-reduce:hidden" />
									<span className="relative inline-flex size-2 rounded-full bg-[#b6ff43]" />
								</span>
								{m.edge_home_running()}
							</p>
							<h1 className="mt-8 max-w-xl font-medium text-5xl leading-[0.98] sm:text-6xl lg:text-7xl">
								{m.edge_home_title_line_1()}
								<span className="block text-[#b6ff43]">
									{m.edge_home_title_line_2()}
								</span>
							</h1>
							<p className="mt-8 max-w-xl text-[#babbb4] text-base leading-8 sm:text-lg">
								{m.edge_home_description()}
							</p>
							<div className="mt-10 flex flex-wrap gap-3">
								<Link
									to="/sign-in"
									search={{ redirect: undefined }}
									className="inline-flex min-h-12 items-center gap-3 bg-[#b6ff43] px-5 font-semibold text-[#10120e] transition-colors hover:bg-[#d4ff8a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b6ff43]"
								>
									{m.edge_home_launch({ name: brand.name })}
									<ArrowRight className="size-4" />
								</Link>
								<Link
									to="/docs"
									className="inline-flex min-h-12 items-center gap-3 border border-white/25 px-5 font-medium text-white transition-colors hover:border-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
								>
									{m.edge_home_explore_api()}
									<ArrowDownRight className="size-4" />
								</Link>
							</div>
						</div>
						<PaymentSignal brandName={brand.name} />
					</div>
					<div className="flex flex-wrap items-center justify-between gap-4 border-white/15 border-t pt-5 text-[#9da098] text-xs uppercase tracking-[0.16em]">
						<span>{m.edge_home_infrastructure()}</span>
						<span>01 / 03</span>
					</div>
				</div>
			</section>

			<section className="border-white/10 border-b bg-[#0b0d0b]">
				<div className="container px-4 py-20 sm:py-28 lg:py-32">
					<div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
						<div>
							<p className="text-[#b6ff43] text-xs uppercase tracking-[0.18em]">
								{m.edge_home_infrastructure()}
							</p>
							<h2 className="mt-5 max-w-md font-medium text-4xl leading-tight sm:text-5xl">
								{m.edge_home_operational_plane()}
							</h2>
						</div>
						<div className="border-white/15 border-t">
							{features.map(({ Icon, index, title, text }) => (
								<article
									className="grid gap-5 border-white/15 border-b py-7 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(12rem,0.75fr)] sm:items-start"
									key={title}
								>
									<span className="text-[#b6ff43] text-xs tracking-[0.14em]">
										{index}
									</span>
									<div>
										<div className="flex items-center gap-3">
											<Icon className="size-4 text-[#b6ff43]" />
											<h3 className="font-medium text-xl">{title}</h3>
										</div>
									</div>
									<p className="text-[#aeb0a8] text-sm leading-6">{text}</p>
								</article>
							))}
						</div>
					</div>
				</div>
			</section>

			<section className="bg-[#ecebe3] text-[#10120e]">
				<div className="container grid gap-14 px-4 py-20 sm:py-28 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20 lg:py-32">
					<div>
						<p className="text-[#477211] text-xs uppercase tracking-[0.18em]">
							{m.edge_home_multichain()}
						</p>
						<h2 className="mt-5 max-w-lg font-medium text-4xl leading-tight sm:text-5xl">
							{m.edge_home_clean_protocol()}
						</h2>
						<ul className="mt-10 grid gap-4 border-[#10120e]/15 border-t pt-6 text-sm leading-6">
							{benefits.map((item) => (
								<li className="flex gap-3" key={item}>
									<Check className="mt-0.5 size-4 shrink-0 text-[#477211]" />
									<span>{item}</span>
								</li>
							))}
						</ul>
					</div>
					<SettlementPath />
				</div>
			</section>
		</div>
	);
}

function HeroGrid() {
	return (
		<div aria-hidden className="absolute inset-0 overflow-hidden">
			<div className="absolute inset-x-0 top-0 h-px bg-white/10" />
			<div className="absolute inset-y-0 left-[8%] w-px bg-white/5" />
			<div className="absolute inset-y-0 right-[8%] w-px bg-white/5" />
			<div className="absolute top-1/4 left-0 h-px w-full bg-white/[0.035]" />
			<div className="absolute top-2/3 left-0 h-px w-full bg-white/[0.035]" />
		</div>
	);
}

function PaymentSignal({ brandName }: { brandName: string }) {
	return (
		<figure
			aria-label={m.edge_home_signal_visual_alt()}
			className="relative mx-auto w-full max-w-[42rem] border border-white/15 bg-[#10130f] p-3 shadow-[18px_18px_0_0_rgba(182,255,67,0.18)] sm:p-5"
		>
			<div className="flex items-center justify-between border-white/10 border-b pb-4">
				<div className="flex items-center gap-3">
					<img
						alt={brandName}
						className="size-9 bg-[#b6ff43] p-1.5"
						height={36}
						src="/pwa-512x512.png"
						width={36}
					/>
					<div>
						<p className="font-medium text-sm">
							{m.edge_home_payment_received()}
						</p>
						<p className="mt-1 text-[#9da098] text-xs">TRON / USDT</p>
					</div>
				</div>
				<BadgeCheck className="size-6 text-[#b6ff43]" />
			</div>
			<div className="grid gap-3 py-4 sm:grid-cols-[1.15fr_0.85fr]">
				<div className="border border-white/10 p-4">
					<p className="text-[#9da098] text-xs uppercase tracking-[0.14em]">
						{m.edge_home_amount_secured()}
					</p>
					<p className="mt-7 font-medium text-4xl sm:text-5xl">125.00</p>
					<p className="mt-2 text-[#b6ff43] text-sm">USDT</p>
				</div>
				<div className="grid border border-white/10">
					<SignalMetric label={m.edge_home_order()} value="T9-29084" />
					<SignalMetric label={m.edge_home_network()} value="TRON" />
					<SignalMetric
						label={m.edge_home_state()}
						value={m.edge_home_final()}
						accent
					/>
				</div>
			</div>
			<div className="border border-white/10 p-4">
				<div className="flex items-center justify-between gap-4 text-xs">
					<span className="text-[#9da098] uppercase tracking-[0.14em]">
						{m.edge_home_confirmation()}
					</span>
					<span className="text-[#b6ff43]">
						{m.edge_home_confirmed_blocks({ current: 20, required: 20 })}
					</span>
				</div>
				<div className="mt-4 flex h-1 gap-1" aria-hidden>
					{confirmedBlockIds.map((blockId) => (
						<span className="flex-1 bg-[#b6ff43]" key={blockId} />
					))}
				</div>
			</div>
			<figcaption className="mt-4 flex items-center gap-2 text-[#9da098] text-xs">
				<RadioTower className="size-3.5 text-[#b6ff43]" />
				{m.edge_home_webhook_signal()}
			</figcaption>
		</figure>
	);
}

function SignalMetric({
	label,
	value,
	accent = false,
}: {
	label: string;
	value: string;
	accent?: boolean;
}) {
	return (
		<div className="flex items-center justify-between border-white/10 border-b px-4 text-xs last:border-b-0">
			<span className="text-[#9da098]">{label}</span>
			<span className={accent ? "text-[#b6ff43]" : "text-white"}>{value}</span>
		</div>
	);
}

function SettlementPath() {
	const steps = [
		m.edge_home_step_intent(),
		m.edge_home_step_verified(),
		m.edge_home_step_settled(),
	];
	return (
		<div className="border-[#10120e]/15 border-y py-6 sm:py-8">
			<div className="flex items-center justify-between gap-3 text-[#477211] text-xs uppercase tracking-[0.16em]">
				<span>{m.edge_home_settlement_path()}</span>
				<LockKeyhole className="size-4" />
			</div>
			<ol className="mt-12 grid gap-6 sm:grid-cols-3 sm:gap-0">
				{steps.map((step, index) => (
					<li className="relative sm:pe-6" key={step}>
						<div className="flex size-9 items-center justify-center rounded-full border border-[#477211] font-medium text-xs">
							0{index + 1}
						</div>
						<p className="mt-5 font-medium text-lg">{step}</p>
						{index < steps.length - 1 ? (
							<div className="absolute top-4 right-0 hidden h-px w-6 bg-[#477211]/40 sm:block" />
						) : null}
					</li>
				))}
			</ol>
			<div className="mt-12 border-[#10120e]/15 border-t pt-5 text-[#575b52] text-sm leading-6">
				{m.edge_home_reconciliation()}
			</div>
		</div>
	);
}
