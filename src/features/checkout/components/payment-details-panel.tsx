import {
	ArrowLeftRight,
	ExternalLink,
	LoaderCircle,
	Timer,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "#/components/ui/button";
import { m } from "#/paraglide/messages";
import {
	type CheckoutOrder,
	type PaymentFlowKind,
	safeHostedPaymentUrl,
} from "../checkout-model";
import { CopyIconButton, formatRemaining } from "./checkout-display";
import { PaymentReviewDialog } from "./payment-review-dialog";
import { TransactionHashDialog } from "./transaction-hash-dialog";

const TIMER_CIRCUMFERENCE = 2 * Math.PI * 20;

export function PaymentDetailsPanel({
	onCopyAddress,
	onChangePaymentOption,
	onSubmitTxHash,
	onTxHashChange,
	order,
	paymentFlow,
	remaining,
	showChangePaymentOption,
	showTxHashSubmit,
	showReviewSubmit,
	submittingTxHash,
	timeColor,
	timerRatio,
	txHash,
	orderId,
	onReviewSubmitted,
}: {
	onCopyAddress: () => boolean | undefined | Promise<boolean | undefined>;
	onChangePaymentOption: () => void;
	onSubmitTxHash: () => Promise<boolean>;
	onTxHashChange: (value: string) => void;
	order?: CheckoutOrder;
	paymentFlow?: PaymentFlowKind;
	remaining: number;
	showChangePaymentOption: boolean;
	showTxHashSubmit: boolean;
	showReviewSubmit: boolean;
	submittingTxHash: boolean;
	timeColor: string;
	timerRatio: number;
	txHash: string;
	orderId: string;
	onReviewSubmitted: () => void;
}) {
	const qrValue = order?.receive_address ?? "";
	const paymentUrl = safeHostedPaymentUrl(order?.payment_url);
	const isOkpayPayment =
		paymentFlow === "okpay" || String(order?.network ?? "") === "okpay";

	if (isOkpayPayment || (paymentUrl && !qrValue)) {
		return (
			<section className="w-full pb-4">
				<div className="mb-4 w-full border border-border bg-card px-5 py-5 text-card-foreground shadow-[8px_8px_0_0_rgba(16,185,129,0.12)] dark:shadow-[8px_8px_0_0_rgba(182,255,67,0.12)]">
					<p className="mb-2 font-semibold text-sm">
						{m.checkout_redirecting_okpay()}
					</p>
					{paymentUrl ? (
						<p className="break-all text-muted-foreground text-sm">
							{paymentUrl}
						</p>
					) : null}
				</div>
				{paymentUrl ? (
					<Button
						className="mb-3 h-12 w-full rounded-none bg-emerald-500 text-emerald-950 text-base hover:bg-emerald-400 dark:bg-[#b6ff43] dark:text-[#10120e] dark:hover:bg-[#d4ff8a]"
						onClick={() => {
							window.open(
								paymentUrl,
								"okpay_checkout",
								"popup,width=480,height=720",
							);
						}}
						type="button"
					>
						<ExternalLink />
						{m.checkout_open_okpay()}
					</Button>
				) : null}
			</section>
		);
	}

	return (
		<section aria-label={m.checkout_scan()} className="w-full pb-4">
			<div className="mb-4 w-full overflow-hidden border border-border bg-card px-5 pt-5 pb-0 text-card-foreground shadow-[8px_8px_0_0_rgba(16,185,129,0.12)] dark:shadow-[8px_8px_0_0_rgba(182,255,67,0.12)]">
				<div className="mb-3 flex items-center justify-between">
					<p className="font-semibold text-sm uppercase tracking-[0.1em]">
						{m.checkout_scan()}
					</p>
					<div className="relative size-10 shrink-0">
						<svg
							aria-hidden="true"
							className="absolute inset-0 size-10"
							viewBox="0 0 48 48"
						>
							<circle
								className="text-border"
								cx="24"
								cy="24"
								fill="none"
								r="20"
								stroke="currentColor"
								strokeWidth="3"
							/>
							<circle
								cx="24"
								cy="24"
								fill="none"
								r="20"
								stroke={timeColor}
								strokeDasharray={TIMER_CIRCUMFERENCE}
								strokeDashoffset={TIMER_CIRCUMFERENCE * (1 - timerRatio)}
								strokeLinecap="round"
								strokeWidth="3"
								style={{
									transform: "rotate(-90deg)",
									transformOrigin: "50% 50%",
								}}
							/>
						</svg>
						<div className="absolute inset-0 flex items-center justify-center">
							<Timer className="size-4 text-muted-foreground" />
						</div>
					</div>
				</div>
				<p
					aria-live="polite"
					className="mb-5 text-center font-bold font-mono text-3xl leading-none"
					style={{ color: timeColor }}
				>
					{formatRemaining(remaining)}
				</p>
				<div className="mb-4 flex justify-center">
					<div className="border-4 border-foreground bg-white p-3 shadow-[6px_6px_0_0_rgba(16,185,129,0.25)] dark:shadow-[6px_6px_0_0_rgba(182,255,67,0.35)]">
						{qrValue ? (
							<QRCodeSVG
								bgColor="#ffffff"
								fgColor="#111111"
								level="M"
								size={120}
								value={qrValue}
							/>
						) : (
							<div className="flex size-30 items-center justify-center text-muted-foreground text-xs">
								--
							</div>
						)}
					</div>
				</div>
				<div className="-mx-5 flex w-[calc(100%+2.5rem)] items-start gap-3 border-border border-t px-5 py-3.5">
					<div className="min-w-0 flex-1">
						<p className="mb-0.5 font-semibold text-muted-foreground text-xs uppercase tracking-[0.12em]">
							{m.checkout_payment_address()}
						</p>
						<p className="break-all font-medium text-foreground text-sm leading-relaxed">
							{order?.receive_address ?? "--"}
						</p>
					</div>
					<CopyIconButton className="mt-0.5" onClick={onCopyAddress} />
				</div>
			</div>
			{showChangePaymentOption ? (
				<Button
					className="mb-3 h-12 w-full rounded-none border-border bg-transparent text-foreground text-base hover:bg-accent hover:text-accent-foreground"
					onClick={onChangePaymentOption}
					type="button"
					variant="outline"
				>
					<ArrowLeftRight />
					{m.checkout_change_payment_asset()}
				</Button>
			) : null}
			{showTxHashSubmit ? (
				<div className="mb-3">
					<TransactionHashDialog
						onSubmit={onSubmitTxHash}
						onValueChange={onTxHashChange}
						submitting={submittingTxHash}
						value={txHash}
					/>
				</div>
			) : null}
			{showReviewSubmit ? (
				<PaymentReviewDialog
					disabled={order?.review_status === "pending"}
					onSubmitted={onReviewSubmitted}
					orderId={orderId}
					transactionHash={txHash}
				/>
			) : null}
			<div className="flex items-center justify-center gap-1.5 py-1 text-muted-foreground">
				<LoaderCircle className="size-3.5 animate-spin text-emerald-600 dark:text-[#b6ff43]" />
				<span className="text-xs">{m.checkout_checking()}</span>
			</div>
		</section>
	);
}
