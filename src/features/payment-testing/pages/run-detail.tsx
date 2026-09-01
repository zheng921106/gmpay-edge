"use client";

import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	ExternalLink,
	FlaskConical,
	RefreshCw,
	RotateCcw,
	Square,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ProButton } from "#/components/pro/base/button";
import { Select } from "#/components/pro/base/fields/select";
import { StatusBadge } from "#/components/status-badge";
import { Badge } from "#/components/ui/badge";
import { EnvironmentBoundary } from "#/features/payment-testing/components/environment-boundary";
import {
	formatPaymentTestDateTime,
	paymentTestCallbackModeLabel,
	paymentTestModeLabel,
	simulatorScenarioLabel,
} from "#/features/payment-testing/components/labels";
import { RunTimeline } from "#/features/payment-testing/components/run-timeline";
import {
	advanceSimulatorScenarioFn,
	cancelPaymentTestRunFn,
	getPaymentTestRunFn,
	refreshRealPaymentTestRunFn,
	retryPaymentTestWebhookFn,
} from "#/features/payment-testing/server/functions";
import type { SimulatorScenario } from "#/features/payment-testing/server/simulator";
import {
	simulatorScenarioSteps,
	simulatorScenarios,
} from "#/features/payment-testing/types";
import { useNavigation } from "#/layouts/components/navigation-context";
import { m } from "#/paraglide/messages";

type PaymentTestRunDetail = Awaited<ReturnType<typeof getPaymentTestRunFn>>;

export function PaymentTestRunDetailPage({
	data,
}: {
	data: PaymentTestRunDetail;
}) {
	const { merchantContext } = useNavigation();
	const [detail, setDetail] = useState(data);
	const [scenario, setScenario] = useState<SimulatorScenario>(
		(data.run.scenario as SimulatorScenario | null) ?? "exact_success",
	);
	const reload = async () =>
		setDetail(await getPaymentTestRunFn({ data: { runId: detail.run.id } }));
	const advance = useMutation({
		mutationFn: advanceSimulatorScenarioFn,
		onSuccess: reload,
		onError: showError,
	});
	const refresh = useMutation({
		mutationFn: refreshRealPaymentTestRunFn,
		onSuccess: () => toast.success(m.payment_test_refresh_queued()),
		onError: showError,
	});
	const retry = useMutation({
		mutationFn: retryPaymentTestWebhookFn,
		onSuccess: reload,
		onError: showError,
	});
	const cancel = useMutation({
		mutationFn: cancelPaymentTestRunFn,
		onSuccess: reload,
		onError: showError,
	});
	const nextStep = detail.run.scenarioStep + 1;
	const retryableDelivery = [...detail.events]
		.reverse()
		.find(
			(event) =>
				event.kind === "webhook.delivery" &&
				["failed", "dead"].includes(event.status ?? ""),
		);
	const busy =
		advance.isPending ||
		refresh.isPending ||
		retry.isPending ||
		cancel.isPending;
	if (!merchantContext) return null;
	return (
		<div className="flex w-full min-w-0 flex-col gap-6 pb-8">
			<EnvironmentBoundary {...merchantContext} />
			<header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<ProButton asChild size="sm" variant="ghost" className="mb-3 -ml-3">
						<Link to="/admin/test-center/runs">
							<ArrowLeft />
							{m.payment_test_runs_title()}
						</Link>
					</ProButton>
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-xl font-semibold">
							{detail.run.externalOrderId}
						</h2>
						<StatusBadge value={detail.run.status} />
					</div>
					<code className="mt-2 block break-all text-xs text-muted-foreground">
						{detail.run.id}
					</code>
				</div>
				<div className="flex flex-wrap gap-2">
					<ProButton
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={reload}
					>
						<RefreshCw />
						{m.common_refresh()}
					</ProButton>
					{detail.run.orderId ? (
						<ProButton asChild variant="outline" size="sm">
							<Link
								to="/checkout/$orderId"
								params={{ orderId: detail.run.orderId }}
								target="_blank"
							>
								<ExternalLink />
								{m.payment_test_open_checkout()}
							</Link>
						</ProButton>
					) : null}
				</div>
			</header>
			<section
				className="grid gap-px border bg-border sm:grid-cols-2 xl:grid-cols-4"
				aria-label={m.payment_test_run_summary()}
			>
				<Metric
					label={m.payment_test_protocol()}
					value={detail.run.protocol.toUpperCase()}
				/>
				<Metric
					label={m.payment_test_mode()}
					value={paymentTestModeLabel(detail.run.mode)}
				/>
				<Metric
					label={m.payment_test_callback()}
					value={paymentTestCallbackModeLabel(detail.run.callbackMode)}
				/>
				<Metric
					label={m.common_created()}
					value={formatPaymentTestDateTime(detail.run.createdAt)}
				/>
			</section>
			{["ready", "running"].includes(detail.run.status) ? (
				<section
					className="flex flex-col gap-3 border-y py-4 sm:flex-row sm:items-end sm:justify-between"
					aria-label={m.payment_test_run_controls()}
				>
					{detail.run.mode === "simulator" ? (
						<div className="grid min-w-0 flex-1 gap-2 sm:max-w-md">
							<span className="text-sm font-medium">
								{m.payment_test_scenario()}
							</span>
							<Select
								ariaLabel={m.payment_test_scenario()}
								value={scenario}
								disabled={detail.run.scenario !== null}
								onChange={(value) => setScenario(value as SimulatorScenario)}
								options={scenarioOptions()}
							/>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							{m.payment_test_external_payment_waiting()}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						{detail.run.mode === "simulator" &&
						nextStep <= simulatorScenarioSteps[scenario] ? (
							<ProButton
								data-simulator-control="true"
								disabled={busy}
								onClick={() =>
									advance.mutate({
										data: { runId: detail.run.id, scenario, step: nextStep },
									})
								}
							>
								<FlaskConical />
								{m.payment_test_run_scenario_step({
									step: nextStep,
									total: simulatorScenarioSteps[scenario],
								})}
							</ProButton>
						) : null}
						{detail.run.mode !== "simulator" ? (
							<ProButton
								disabled={busy}
								onClick={() =>
									refresh.mutate({ data: { runId: detail.run.id } })
								}
							>
								<RefreshCw />
								{m.payment_test_check_payment()}
							</ProButton>
						) : null}
						{retryableDelivery ? (
							<ProButton
								variant="outline"
								disabled={busy}
								onClick={() =>
									retry.mutate({
										data: {
											runId: detail.run.id,
											deliveryId: retryableDelivery.id.replace("delivery:", ""),
										},
									})
								}
							>
								<RotateCcw />
								{m.payment_test_retry_callback()}
							</ProButton>
						) : null}
						<ProButton
							variant="ghost"
							disabled={busy}
							onClick={() => cancel.mutate({ data: { runId: detail.run.id } })}
						>
							<Square />
							{m.common_cancel()}
						</ProButton>
					</div>
				</section>
			) : null}
			<section
				className="grid gap-6 xl:grid-cols-2"
				aria-label={m.payment_test_protocol_exchange()}
			>
				<Snapshot
					title={m.payment_test_request()}
					value={detail.run.requestSnapshot}
				/>
				<Snapshot
					title={m.payment_test_response()}
					value={detail.run.responseSnapshot}
				/>
			</section>
			<section className="min-w-0">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-base font-semibold">
						{m.payment_test_timeline_title()}
					</h2>
					<Badge variant="outline">{detail.events.length}</Badge>
				</div>
				<RunTimeline events={detail.events} />
			</section>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 bg-background p-4">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 truncate text-sm font-semibold">{value}</p>
		</div>
	);
}
function Snapshot({ title, value }: { title: string; value: unknown }) {
	return (
		<div className="min-w-0">
			<h2 className="mb-3 text-sm font-semibold">{title}</h2>
			<pre className="max-h-80 overflow-auto border bg-muted/35 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
				{JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
}
function scenarioOptions() {
	return simulatorScenarios.map((value) => ({
		value,
		label: simulatorScenarioLabel(value),
	}));
}
function showError() {
	toast.error(m.payment_test_operation_failed());
}
