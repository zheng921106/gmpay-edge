import { Building2, FlaskConical, TriangleAlert } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { m } from "#/paraglide/messages";

export function EnvironmentBoundary({
	environment,
	merchantId,
	environmentId,
}: {
	environment: "sandbox" | "production";
	merchantId: string;
	environmentId: string;
}) {
	const production = environment === "production";
	const Icon = production ? TriangleAlert : FlaskConical;
	return (
		<section
			data-environment={environment}
			data-real-funds={production ? "true" : undefined}
			className={
				production
					? "flex flex-col gap-3 border-y border-destructive/35 bg-destructive/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
					: "flex flex-col gap-3 border-y border-emerald-500/30 bg-emerald-500/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-400/25"
			}
		>
			<div className="flex min-w-0 items-start gap-3">
				<div
					className={
						production
							? "flex size-9 shrink-0 items-center justify-center border border-destructive/30 bg-background text-destructive"
							: "flex size-9 shrink-0 items-center justify-center border border-emerald-500/30 bg-background text-emerald-700 dark:text-emerald-300"
					}
				>
					<Icon className="size-4" />
				</div>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<strong className="text-sm">
							{production
								? m.merchant_environment_production()
								: m.merchant_environment_sandbox()}
						</strong>
						<Badge variant={production ? "destructive" : "secondary"}>
							{production
								? m.payment_test_real_funds()
								: m.payment_test_isolated_funds()}
						</Badge>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						{production
							? m.payment_test_production_boundary()
							: m.payment_test_sandbox_boundary()}
					</p>
				</div>
			</div>
			<div className="grid shrink-0 gap-1 text-xs text-muted-foreground sm:text-end">
				<span className="inline-flex items-center gap-1.5 sm:justify-end">
					<Building2 className="size-3.5" />
					{shortIdentifier(merchantId)}
				</span>
				<code>{shortIdentifier(environmentId)}</code>
			</div>
		</section>
	);
}

function shortIdentifier(value: string) {
	return value.length > 24
		? `${value.slice(0, 12)}...${value.slice(-8)}`
		: value;
}
