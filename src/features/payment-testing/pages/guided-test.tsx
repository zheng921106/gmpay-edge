"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	CheckCircle2,
	ExternalLink,
	FlaskConical,
	Play,
	RefreshCw,
	ShieldCheck,
	Square,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ProButton } from "#/components/pro/base/button";
import { Input, Textarea } from "#/components/pro/base/fields/input";
import { Segmented } from "#/components/pro/base/fields/radio";
import { Select } from "#/components/pro/base/fields/select";
import { FormItem, ProForm } from "#/components/pro/form";
import { Badge } from "#/components/ui/badge";
import { EnvironmentBoundary } from "#/features/payment-testing/components/environment-boundary";
import { simulatorScenarioLabel } from "#/features/payment-testing/components/labels";
import {
	paymentTestOperationErrorMessage,
	paymentTestRequiresReceivingMethodConfiguration,
} from "#/features/payment-testing/error-message";
import {
	advanceSimulatorScenarioFn,
	cancelPaymentTestRunFn,
	confirmProductionPaymentTestRunFn,
	getPaymentTestResourcesFn,
	getPaymentTestRunFn,
	preflightPaymentTestFn,
	refreshRealPaymentTestRunFn,
	startPaymentTestRunFn,
} from "#/features/payment-testing/server/functions";
import type { SimulatorScenario } from "#/features/payment-testing/server/simulator";
import type {
	PaymentTestExpectedOutcome,
	PaymentTestMode,
	PaymentTestProtocol,
} from "#/features/payment-testing/types";
import {
	simulatorScenarioSteps,
	simulatorScenarios,
} from "#/features/payment-testing/types";
import { ConfirmDialog } from "#/layouts/components/confirm-dialog";
import { useNavigation } from "#/layouts/components/navigation-context";
import { currencyDecimals, decimalToMinor } from "#/lib/units";
import { m } from "#/paraglide/messages";

type PaymentTestResources = Awaited<
	ReturnType<typeof getPaymentTestResourcesFn>
>;

export { simulatorScenarioSteps as scenarioSteps };

type PaymentTestDraft = {
	protocol: PaymentTestProtocol;
	paymentMode: PaymentTestMode;
	apiKeyId: string;
	receivingMethodId: string;
	paymentAssetId: string;
	amount: string;
	currency: string;
	externalOrderId: string;
	clientIdempotencyKey: string;
	callbackMode: "builtin" | "custom";
	callbackUrl: string;
	returnUrl: string;
	description: string;
	scenario: SimulatorScenario;
	rawInput: string;
};

export function GuidedPaymentTestPage() {
	return <PaymentTestComposer />;
}

export function PaymentTestComposer({
	consoleMode = false,
}: {
	consoleMode?: boolean;
}) {
	const { merchantContext } = useNavigation();
	const resources = useQuery({
		queryKey: [
			"payment-test-resources",
			merchantContext?.merchantId,
			merchantContext?.environmentId,
		],
		queryFn: () => getPaymentTestResourcesFn(),
		enabled: Boolean(merchantContext),
		staleTime: 0,
		refetchOnWindowFocus: "always",
	});
	if (!merchantContext)
		return <EmptyState message={m.payment_test_select_environment()} />;
	if (resources.isPending) return <EmptyState message={m.common_loading()} />;
	if (!resources.data)
		return <EmptyState message={m.payment_test_resources_unavailable()} />;
	return (
		<PaymentTestWorkspace
			key={`${merchantContext.merchantId}:${merchantContext.environmentId}`}
			context={merchantContext}
			resources={resources.data}
			onRefreshResources={() => {
				void resources.refetch();
			}}
			refreshingResources={resources.isFetching}
			consoleMode={consoleMode}
		/>
	);
}

function PaymentTestWorkspace({
	context,
	resources,
	onRefreshResources,
	refreshingResources,
	consoleMode,
}: {
	context: NonNullable<ReturnType<typeof useNavigation>["merchantContext"]>;
	resources: PaymentTestResources;
	onRefreshResources: () => void;
	refreshingResources: boolean;
	consoleMode: boolean;
}) {
	const [draft, setDraft] = useState(() =>
		defaultPaymentTestValues(resources, context.environment),
	);
	const [readyInput, setReadyInput] = useState<string | null>(null);
	const [
		preflightNeedsReceivingMethodConfiguration,
		setPreflightNeedsReceivingMethodConfiguration,
	] = useState(false);
	const [activeRun, setActiveRun] = useState<{
		runId: string;
		orderId: string | null;
		status: string;
	} | null>(null);
	const [confirmation, setConfirmation] = useState<{
		runId: string;
		token: string;
	} | null>(null);
	const [scenarioStep, setScenarioStep] = useState(1);
	useEffect(() => {
		setDraft((current) => selectCompatibleMethod(current, resources));
	}, [resources]);
	const input = useMemo(() => buildStartInput(draft), [draft]);
	const inputKey = input ? JSON.stringify(input) : null;
	const evidence = useQuery({
		queryKey: ["payment-test-run", activeRun?.runId],
		queryFn: () =>
			getPaymentTestRunFn({ data: { runId: activeRun?.runId ?? "" } }),
		enabled: consoleMode && Boolean(activeRun?.runId),
	});
	const preflight = useMutation({
		mutationFn: preflightPaymentTestFn,
		onSuccess: () => {
			setReadyInput(inputKey);
			setPreflightNeedsReceivingMethodConfiguration(false);
			toast.success(m.payment_test_preflight_ready());
		},
		onError: (error) => {
			setPreflightNeedsReceivingMethodConfiguration(
				paymentTestRequiresReceivingMethodConfiguration(error),
			);
			showPaymentTestError(error);
		},
	});
	const start = useMutation({
		mutationFn: startPaymentTestRunFn,
		onSuccess: (result) => {
			setReadyInput(inputKey);
			if (result.confirmationRequired && result.confirmationToken) {
				setConfirmation({
					runId: result.runId,
					token: result.confirmationToken,
				});
				return;
			}
			setActiveRun(result);
			toast.success(m.payment_test_run_started());
		},
		onError: showPaymentTestError,
	});
	const confirm = useMutation({
		mutationFn: confirmProductionPaymentTestRunFn,
		onSuccess: (result) => {
			setConfirmation(null);
			setActiveRun(result);
			toast.success(m.payment_test_run_started());
		},
		onError: showPaymentTestError,
	});
	const advance = useMutation({
		mutationFn: advanceSimulatorScenarioFn,
		onSuccess: () => {
			setScenarioStep((current) => current + 1);
			toast.success(m.payment_test_scenario_advanced());
		},
		onError: showPaymentTestError,
	});
	const refresh = useMutation({
		mutationFn: refreshRealPaymentTestRunFn,
		onSuccess: () => toast.success(m.payment_test_refresh_queued()),
		onError: showPaymentTestError,
	});
	const cancel = useMutation({
		mutationFn: cancelPaymentTestRunFn,
		onSuccess: () => {
			setActiveRun((current) =>
				current ? { ...current, status: "cancelled" } : current,
			);
			toast.success(m.payment_test_cancelled());
		},
		onError: showPaymentTestError,
	});

	const selectedMethod = resources.receivingMethods.find(
		(method) =>
			method.id === draft.receivingMethodId &&
			method.assetId === draft.paymentAssetId,
	);
	const availableMethods = resources.receivingMethods.filter(
		(method) => method.networkClass === networkClassForMode(draft.paymentMode),
	);
	const hasAvailableMethods = availableMethods.length > 0;
	const requestPreview = {
		method: "POST",
		path:
			draft.protocol === "gmpay"
				? "/payments/gmpay/v1/order/create-transaction"
				: "/payments/epay/v1/order/create-transaction/submit.php",
		headers: {
			"content-type":
				draft.protocol === "gmpay"
					? "application/json"
					: "application/x-www-form-urlencoded",
		},
		body: input
			? { ...input, signature: "[SERVER GENERATED]", rawInput: undefined }
			: null,
	};

	return (
		<div className="flex w-full min-w-0 flex-col gap-5 pb-8">
			<EnvironmentBoundary
				environment={context.environment}
				merchantId={context.merchantId}
				environmentId={context.environmentId}
			/>
			<div
				className={
					consoleMode
						? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]"
						: "grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]"
				}
			>
				<ProForm
					className="min-w-0"
					onFinish={async () => {
						if (!input) return showPaymentTestError();
						await start.mutateAsync({ data: input });
					}}
					onFinishFailed={showPaymentTestError}
					submitter={
						<div className="flex flex-wrap gap-2 border-t pt-4">
							<ProButton
								variant="outline"
								loading={preflight.isPending}
								disabled={!input}
								onClick={() => input && preflight.mutate({ data: input })}
							>
								<ShieldCheck />
								{m.payment_test_check_readiness()}
							</ProButton>
							<ProButton
								type="submit"
								loading={start.isPending}
								disabled={!input}
							>
								<Play />
								{context.environment === "production"
									? m.payment_test_prepare_production()
									: m.payment_test_start()}
							</ProButton>
						</div>
					}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<FormItem label={m.payment_test_protocol()} required>
							<Segmented
								value={draft.protocol}
								onChange={(protocol) =>
									setDraft((current) => ({
										...current,
										protocol: protocol as PaymentTestProtocol,
									}))
								}
								options={[
									{ value: "gmpay", label: "GMPay" },
									{ value: "epay", label: "EPay" },
								]}
							/>
						</FormItem>
						<FormItem label={m.payment_test_mode()} required>
							<Segmented
								value={draft.paymentMode}
								disabled={context.environment === "production"}
								onChange={(value) =>
									selectMode(value as PaymentTestMode, resources, setDraft)
								}
								options={
									context.environment === "production"
										? [{ value: "live", label: m.payment_test_mode_live() }]
										: [
												{
													value: "simulator",
													label: m.payment_test_mode_simulator(),
													disabled: !hasNetworkClass(resources, "simulated"),
												},
												{
													value: "testnet",
													label: m.payment_test_mode_testnet(),
													disabled: !hasNetworkClass(resources, "testnet"),
												},
											]
								}
							/>
						</FormItem>
						{draft.paymentMode === "simulator" ? (
							<FormItem label={m.payment_test_scenario()} required>
								<Select
									value={draft.scenario}
									onChange={(value) => {
										setScenarioStep(1);
										setDraft((current) => ({
											...current,
											scenario: value as SimulatorScenario,
										}));
									}}
									options={simulatorScenarios.map((value) => ({
										value,
										label: simulatorScenarioLabel(value),
									}))}
								/>
							</FormItem>
						) : null}
						<FormItem label={m.payment_test_api_key()} required>
							<Select
								value={draft.apiKeyId}
								onChange={(value) =>
									setDraft((current) => ({
										...current,
										apiKeyId: String(value ?? ""),
									}))
								}
								options={resources.apiKeys.map((key) => ({
									value: key.id,
									label: `${key.name} · ${key.pid}`,
								}))}
							/>
						</FormItem>
						<FormItem label={m.payment_test_receiving_method()} required>
							<Select
								value={methodValue(draft)}
								onChange={(value) =>
									selectMethod(String(value ?? ""), resources, setDraft)
								}
								disabled={!hasAvailableMethods}
								placeholder={
									hasAvailableMethods
										? undefined
										: m.payment_test_no_compatible_method()
								}
								options={availableMethods.map((method) => ({
									value: methodValue(method),
									label: `${method.name} · ${method.assetCode} · ${method.railName}`,
								}))}
							/>
							{!hasAvailableMethods ? (
								<div
									data-payment-test-method-status="configuration-required"
									className="flex flex-wrap items-center gap-2 pt-1 text-sm text-muted-foreground"
								>
									<span>{m.payment_test_no_compatible_method()}</span>
									<ProButton asChild size="xs" variant="outline">
										<a href="/admin/receiving-methods">
											{m.receiving_methods_title()}
										</a>
									</ProButton>
									<ProButton
										data-payment-test-resources-refresh="true"
										size="xs"
										variant="ghost"
										loading={refreshingResources}
										onClick={onRefreshResources}
									>
										<RefreshCw />
										{m.common_refresh()}
									</ProButton>
								</div>
							) : null}
						</FormItem>
						<FormItem label={m.payment_test_amount()} required>
							<Input
								value={draft.amount}
								inputMode="decimal"
								suffix={draft.currency}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										amount: event.target.value,
									}))
								}
							/>
						</FormItem>
						<FormItem label={m.common_currency()} required>
							<Select
								value={draft.currency}
								onChange={(value) =>
									setDraft((current) => ({
										...current,
										currency: String(value ?? "USD"),
									}))
								}
								options={["USD", "EUR", "CNY", "JPY"].map((value) => ({
									value,
									label: value,
								}))}
							/>
						</FormItem>
						<FormItem label={m.payment_test_external_order_id()} required>
							<Input
								value={draft.externalOrderId}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										externalOrderId: event.target.value,
									}))
								}
							/>
						</FormItem>
						<FormItem label={m.payment_test_callback()} required>
							<Segmented
								value={draft.callbackMode}
								onChange={(value) =>
									setDraft((current) => ({
										...current,
										callbackMode: value as "builtin" | "custom",
									}))
								}
								options={[
									{
										value: "builtin",
										label: m.payment_test_callback_builtin(),
									},
									{ value: "custom", label: m.payment_test_callback_custom() },
								]}
							/>
						</FormItem>
						{draft.callbackMode === "custom" ? (
							<FormItem
								label={m.payment_test_callback_url()}
								required
								className="sm:col-span-2"
							>
								<Input
									type="url"
									value={draft.callbackUrl}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											callbackUrl: event.target.value,
										}))
									}
								/>
							</FormItem>
						) : null}
						<FormItem
							label={m.payment_test_return_url()}
							className="sm:col-span-2"
						>
							<Input
								type="url"
								value={draft.returnUrl}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										returnUrl: event.target.value,
									}))
								}
							/>
						</FormItem>
						<FormItem
							label={m.payment_test_description_label()}
							className="sm:col-span-2"
						>
							<Input
								value={draft.description}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										description: event.target.value,
									}))
								}
							/>
						</FormItem>
						{consoleMode ? (
							<FormItem
								label={m.payment_test_raw_parameters()}
								description={m.payment_test_raw_parameters_description()}
								className="sm:col-span-2"
							>
								<Textarea
									className="min-h-36 font-mono text-xs"
									value={draft.rawInput}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											rawInput: event.target.value,
										}))
									}
								/>
							</FormItem>
						) : null}
					</div>
				</ProForm>

				<aside className="min-w-0 space-y-4 border-t pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
					{consoleMode ? (
						<ProtocolPreview
							preview={
								evidence.data
									? {
											request: evidence.data.run.requestSnapshot,
											response: evidence.data.run.responseSnapshot,
										}
									: requestPreview
							}
							selectedMethod={selectedMethod}
						/>
					) : (
						<ReadinessSummary
							ready={inputKey !== null && readyInput === inputKey}
							resources={resources}
							selectedMethod={selectedMethod}
							needsReceivingMethodConfiguration={
								preflightNeedsReceivingMethodConfiguration
							}
						/>
					)}
					{activeRun ? (
						<RunLaunchActions
							run={activeRun}
							mode={draft.paymentMode}
							scenario={draft.scenario}
							step={scenarioStep}
							onAdvance={() =>
								advance.mutate({
									data: {
										runId: activeRun.runId,
										scenario: draft.scenario,
										step: scenarioStep,
									},
								})
							}
							onRefresh={() =>
								refresh.mutate({ data: { runId: activeRun.runId } })
							}
							onCancel={() =>
								cancel.mutate({ data: { runId: activeRun.runId } })
							}
							busy={advance.isPending || refresh.isPending || cancel.isPending}
						/>
					) : null}
				</aside>
			</div>
			<ConfirmDialog
				open={Boolean(confirmation)}
				onOpenChange={(open) => !open && setConfirmation(null)}
				title={m.payment_test_production_confirmation_title()}
				desc={m.payment_test_production_confirmation_description()}
				confirmText={m.payment_test_confirm_real_payment()}
				destructive
				isLoading={confirm.isPending}
				handleConfirm={() =>
					confirmation &&
					confirm.mutate({
						data: {
							runId: confirmation.runId,
							confirmationToken: confirmation.token,
						},
					})
				}
			>
				<div className="grid gap-2 border-y py-4 text-sm">
					<ConfirmationRow
						label={m.payment_test_amount()}
						value={`${draft.amount} ${draft.currency}`}
					/>
					<ConfirmationRow
						label={m.payment_test_asset_network()}
						value={
							selectedMethod
								? `${selectedMethod.assetCode} · ${selectedMethod.railName}`
								: "-"
						}
					/>
					<ConfirmationRow
						label={m.payment_test_callback()}
						value={
							draft.callbackMode === "builtin"
								? m.payment_test_callback_builtin()
								: draft.callbackUrl
						}
					/>
					<p className="mt-2 font-medium text-destructive">
						{m.payment_test_real_funds_warning()}
					</p>
				</div>
			</ConfirmDialog>
		</div>
	);
}

export function defaultPaymentTestValues(
	resources: Pick<PaymentTestResources, "apiKeys" | "receivingMethods">,
	environment: "sandbox" | "production",
): PaymentTestDraft {
	const mode: PaymentTestMode =
		environment === "production" ? "live" : "simulator";
	const expectedClass = networkClassForMode(mode);
	const method =
		resources.receivingMethods.find(
			(candidate) =>
				candidate.networkClass === expectedClass ||
				(mode === "simulator" && candidate.railCode === "simulator"),
		) ?? resources.receivingMethods[0];
	const nonce = crypto.randomUUID();
	return {
		protocol: "gmpay",
		paymentMode: mode,
		apiKeyId: resources.apiKeys[0]?.id ?? "",
		receivingMethodId: method?.id ?? "",
		paymentAssetId: method?.assetId ?? "",
		amount: "1.00",
		currency: "USD",
		externalOrderId: `test-${Date.now()}`,
		clientIdempotencyKey: nonce,
		callbackMode: "builtin",
		callbackUrl: "",
		returnUrl: "",
		description: "",
		scenario: "exact_success",
		rawInput: "",
	};
}

function buildStartInput(draft: PaymentTestDraft) {
	try {
		if (
			!(
				draft.apiKeyId &&
				draft.receivingMethodId &&
				draft.paymentAssetId &&
				draft.externalOrderId
			)
		)
			return null;
		const amountMinor = decimalToMinor(
			draft.amount,
			currencyDecimals(draft.currency),
		).toString();
		return {
			protocol: draft.protocol,
			paymentMode: draft.paymentMode,
			apiKeyId: draft.apiKeyId,
			receivingMethodId: draft.receivingMethodId,
			paymentAssetId: draft.paymentAssetId,
			amountMinor,
			currency: draft.currency,
			externalOrderId: draft.externalOrderId,
			clientIdempotencyKey: draft.clientIdempotencyKey,
			callback:
				draft.callbackMode === "builtin"
					? { mode: "builtin" as const }
					: { mode: "custom" as const, url: draft.callbackUrl },
			...(draft.returnUrl ? { returnUrl: draft.returnUrl } : {}),
			...(draft.description ? { description: draft.description } : {}),
			expectedOutcome: expectedOutcomeForScenario(draft.scenario),
			...(draft.rawInput ? { rawInput: draft.rawInput } : {}),
		};
	} catch {
		return null;
	}
}

function ReadinessSummary({
	ready,
	resources,
	selectedMethod,
	needsReceivingMethodConfiguration,
}: {
	ready: boolean;
	resources: PaymentTestResources;
	selectedMethod: PaymentTestResources["receivingMethods"][number] | undefined;
	needsReceivingMethodConfiguration: boolean;
}) {
	return (
		<section className="space-y-4" aria-label={m.payment_test_readiness()}>
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-semibold">{m.payment_test_readiness()}</h2>
				<Badge variant={ready ? "default" : "secondary"}>
					{ready ? m.payment_test_ready() : m.payment_test_not_checked()}
				</Badge>
			</div>
			<div className="grid gap-3 text-sm">
				<SummaryRow
					label={m.payment_test_credentials()}
					value={String(resources.apiKeys.length)}
				/>
				<SummaryRow
					label={m.payment_test_receiving_methods()}
					value={String(resources.receivingMethods.length)}
				/>
				<SummaryRow
					label={m.payment_test_asset_network()}
					value={
						selectedMethod
							? `${selectedMethod.assetCode} · ${selectedMethod.railName}`
							: m.payment_test_no_compatible_method()
					}
				/>
			</div>
			{needsReceivingMethodConfiguration ? (
				<div
					className="space-y-3 border border-destructive/30 bg-destructive/5 p-3 text-sm"
					data-payment-test-method-status="invalid-target"
				>
					<p>{m.payment_test_error_receiving_target_invalid()}</p>
					<ProButton asChild size="sm" variant="outline">
						<Link to="/admin/receiving-methods">
							{m.receiving_methods_title()}
							<ArrowRight />
						</Link>
					</ProButton>
				</div>
			) : null}
		</section>
	);
}

function ProtocolPreview({
	preview,
	selectedMethod,
}: {
	preview: Record<string, unknown>;
	selectedMethod: PaymentTestResources["receivingMethods"][number] | undefined;
}) {
	return (
		<section
			className="space-y-3"
			aria-label={m.payment_test_request_preview()}
		>
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-semibold">{m.payment_test_request_preview()}</h2>
				<Badge variant="outline">{selectedMethod?.assetCode ?? "-"}</Badge>
			</div>
			<pre className="max-h-[38rem] overflow-auto border bg-muted/35 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
				{JSON.stringify(preview, null, 2)}
			</pre>
		</section>
	);
}

function RunLaunchActions({
	run,
	mode,
	scenario,
	step,
	onAdvance,
	onRefresh,
	onCancel,
	busy,
}: {
	run: { runId: string; orderId: string | null; status: string };
	mode: PaymentTestMode;
	scenario: SimulatorScenario;
	step: number;
	onAdvance: () => void;
	onRefresh: () => void;
	onCancel: () => void;
	busy: boolean;
}) {
	const totalSteps = simulatorScenarioSteps[scenario];
	return (
		<section
			className="space-y-3 border-t pt-4"
			aria-label={m.payment_test_active_run()}
		>
			<div className="flex items-center gap-2">
				<CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
				<h2 className="font-semibold">{m.payment_test_active_run()}</h2>
			</div>
			<code className="block break-all text-xs text-muted-foreground">
				{run.runId}
			</code>
			{mode === "simulator" && step <= totalSteps ? (
				<ProButton
					data-simulator-control="true"
					className="w-full"
					disabled={busy}
					onClick={onAdvance}
				>
					<FlaskConical />
					{m.payment_test_run_scenario_step({ step, total: totalSteps })}
				</ProButton>
			) : mode !== "simulator" ? (
				<ProButton
					className="w-full"
					variant="outline"
					disabled={busy}
					onClick={onRefresh}
				>
					<RefreshCw />
					{m.payment_test_check_payment()}
				</ProButton>
			) : null}
			<ProButton asChild className="w-full" variant="outline">
				<Link to="/admin/test-center/runs/$runId" params={{ runId: run.runId }}>
					<ArrowRight />
					{m.payment_test_view_evidence()}
				</Link>
			</ProButton>
			{run.orderId ? (
				<ProButton asChild className="w-full" variant="ghost">
					<Link
						to="/checkout/$orderId"
						params={{ orderId: run.orderId }}
						target="_blank"
					>
						<ExternalLink />
						{m.payment_test_open_checkout()}
					</Link>
				</ProButton>
			) : null}
			{["ready", "running"].includes(run.status) ? (
				<ProButton
					className="w-full"
					variant="ghost"
					disabled={busy}
					onClick={onCancel}
				>
					<Square />
					{m.common_cancel()}
				</ProButton>
			) : null}
		</section>
	);
}

function EmptyState({ message }: { message: string }) {
	return (
		<div className="flex min-h-56 w-full items-center justify-center border border-dashed p-6 text-sm text-muted-foreground">
			{message}
		</div>
	);
}
function SummaryRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-start justify-between gap-4 border-b pb-2">
			<span className="text-muted-foreground">{label}</span>
			<strong className="text-end text-xs">{value}</strong>
		</div>
	);
}
function ConfirmationRow(props: { label: string; value: string }) {
	return <SummaryRow {...props} />;
}
function methodValue(value: {
	id?: string;
	receivingMethodId?: string;
	assetId?: string;
	paymentAssetId?: string;
}) {
	return `${value.id ?? value.receivingMethodId ?? ""}:${value.assetId ?? value.paymentAssetId ?? ""}`;
}
function networkClassForMode(mode: PaymentTestMode) {
	return mode === "live"
		? "mainnet"
		: mode === "testnet"
			? "testnet"
			: "simulated";
}
function hasNetworkClass(
	resources: PaymentTestResources,
	networkClass: "simulated" | "testnet" | "mainnet",
) {
	return resources.receivingMethods.some(
		(method) => method.networkClass === networkClass,
	);
}
function selectMode(
	mode: PaymentTestMode,
	resources: PaymentTestResources,
	setDraft: React.Dispatch<React.SetStateAction<PaymentTestDraft>>,
) {
	const method = firstCompatibleMethod(resources, mode);
	setDraft((current) => ({
		...current,
		paymentMode: mode,
		receivingMethodId: method?.id ?? "",
		paymentAssetId: method?.assetId ?? "",
	}));
}
function selectCompatibleMethod(
	draft: PaymentTestDraft,
	resources: PaymentTestResources,
) {
	const selected = resources.receivingMethods.find(
		(item) =>
			item.id === draft.receivingMethodId &&
			item.assetId === draft.paymentAssetId &&
			item.networkClass === networkClassForMode(draft.paymentMode),
	);
	if (selected) return draft;
	const method = firstCompatibleMethod(resources, draft.paymentMode);
	if (!method) return draft;
	return {
		...draft,
		receivingMethodId: method.id,
		paymentAssetId: method.assetId,
	};
}
function firstCompatibleMethod(
	resources: PaymentTestResources,
	mode: PaymentTestMode,
) {
	return resources.receivingMethods.find(
		(item) => item.networkClass === networkClassForMode(mode),
	);
}
function selectMethod(
	value: string,
	resources: PaymentTestResources,
	setDraft: React.Dispatch<React.SetStateAction<PaymentTestDraft>>,
) {
	const method = resources.receivingMethods.find(
		(item) => methodValue(item) === value,
	);
	if (method)
		setDraft((current) => ({
			...current,
			receivingMethodId: method.id,
			paymentAssetId: method.assetId,
		}));
}
function expectedOutcomeForScenario(
	scenario: SimulatorScenario,
): PaymentTestExpectedOutcome {
	const outcomes: Record<SimulatorScenario, PaymentTestExpectedOutcome> = {
		exact_success: "paid",
		partial_then_complete: "partial",
		overpayment: "overpaid",
		confirmation_progression: "paid",
		failed_transaction: "failed_payment",
		duplicate_delivery: "paid",
		late_payment: "late_payment",
		reorg_then_recover: "reorg_recovered",
		callback_failure_then_retry: "callback_retry_succeeded",
	};
	return outcomes[scenario];
}
function showPaymentTestError(error?: unknown) {
	toast.error(paymentTestOperationErrorMessage(error));
}
