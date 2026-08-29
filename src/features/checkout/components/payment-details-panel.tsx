import {
	ArrowLeftRight,
	Check,
	ExternalLink,
	LoaderCircle,
	Send,
	Timer,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Input } from "#/components/pro/base/fields/input";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { m } from "#/paraglide/messages";
import {
	type CheckoutOrder,
	type PaymentFlowKind,
	safeHostedPaymentUrl,
} from "../checkout-model";
import { CopyIconButton, formatRemaining } from "./checkout-display";
import { PaymentReviewDialog } from "./payment-review-dialog";

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
	const [txHashDialogOpen, setTxHashDialogOpen] = useState(false);
	const qrValue = order?.receive_address ?? "";
	const paymentUrl = safeHostedPaymentUrl(order?.payment_url);
	const isOkpayPayment =
		paymentFlow === "okpay" || String(order?.network ?? "") === "okpay";

	if (isOkpayPayment || (paymentUrl && !qrValue)) {
		return (
			<section className="w-full pb-4">
				<div className="mb-4 w-full border border-white/15 bg-[#10130f] px-5 py-5 text-[#f5f4ed] shadow-[8px_8px_0_0_rgba(182,255,67,0.12)]">
					<p className="mb-2 font-semibold text-sm">
						{m.checkout_redirecting_okpay()}
					</p>
					{paymentUrl ? (
						<p className="break-all text-[#9da098] text-sm">{paymentUrl}</p>
					) : null}
				</div>
				{paymentUrl ? (
					<Button
						className="mb-3 h-12 w-full rounded-none bg-[#b6ff43] text-[#10120e] text-base hover:bg-[#d4ff8a]"
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
			<div className="mb-4 w-full overflow-hidden border border-white/15 bg-[#10130f] px-5 pt-5 pb-0 text-[#f5f4ed] shadow-[8px_8px_0_0_rgba(182,255,67,0.12)]">
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
								className="text-white/15"
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
							<Timer className="size-4 text-[#9da098]" />
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
					<div className="border-4 border-[#f5f4ed] bg-white p-3 shadow-[6px_6px_0_0_rgba(182,255,67,0.35)]">
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
				<div className="-mx-5 flex w-[calc(100%+2.5rem)] items-start gap-3 border-white/15 border-t px-5 py-3.5">
					<div className="min-w-0 flex-1">
						<p className="mb-0.5 font-semibold text-[#9da098] text-xs uppercase tracking-[0.12em]">
							{m.checkout_payment_address()}
						</p>
						<p className="break-all font-medium text-[#f5f4ed] text-sm leading-relaxed">
							{order?.receive_address ?? "--"}
						</p>
					</div>
					<CopyIconButton className="mt-0.5" onClick={onCopyAddress} />
				</div>
			</div>
			{showChangePaymentOption ? (
				<Button
					className="mb-3 h-12 w-full rounded-none border-white/25 bg-transparent text-[#f5f4ed] text-base hover:bg-white/10 hover:text-[#f5f4ed]"
					onClick={onChangePaymentOption}
					type="button"
					variant="outline"
				>
					<ArrowLeftRight />
					{m.checkout_change_payment_asset()}
				</Button>
			) : null}
			{showTxHashSubmit ? (
				<Dialog onOpenChange={setTxHashDialogOpen} open={txHashDialogOpen}>
					<DialogTrigger asChild>
						<Button
							className="mb-3 h-12 w-full rounded-none bg-[#b6ff43] text-[#10120e] text-base hover:bg-[#d4ff8a]"
							type="button"
						>
							<Check />
							{m.checkout_transferred()}
						</Button>
					</DialogTrigger>
					<DialogContent className="border-white/15 bg-[#10130f] text-[#f5f4ed] sm:max-w-md">
						<DialogHeader>
							<DialogTitle>{m.checkout_tx_hash_title()}</DialogTitle>
							<DialogDescription className="text-[#9da098]">
								{m.checkout_tx_hash_desc()}
							</DialogDescription>
						</DialogHeader>
						<form
							className="space-y-4"
							onSubmit={async (event) => {
								event.preventDefault();
								const submitted = await onSubmitTxHash();
								if (submitted) {
									setTxHashDialogOpen(false);
								}
							}}
						>
							<div className="space-y-2">
								<label
									className="font-medium text-sm"
									htmlFor="checkout-tx-hash"
								>
									{m.checkout_tx_hash_label()}
								</label>
								<Input
									autoComplete="off"
									autoFocus
									className="h-11 rounded-none border-white/20 bg-black/20 text-[#f5f4ed] placeholder:text-[#777a72]"
									disabled={submittingTxHash}
									id="checkout-tx-hash"
									onChange={(event) => onTxHashChange(event.target.value)}
									placeholder={m.checkout_tx_hash_placeholder()}
									value={txHash}
								/>
							</div>
							<p className="text-[#9da098] text-xs leading-relaxed">
								{m.checkout_tx_hash_hint()}
							</p>
							<DialogFooter>
								<DialogClose asChild>
									<Button
										className="rounded-none border-white/25 bg-transparent text-[#f5f4ed] hover:bg-white/10 hover:text-[#f5f4ed]"
										disabled={submittingTxHash}
										type="button"
										variant="outline"
									>
										{m.common_cancel()}
									</Button>
								</DialogClose>
								<Button
									className="rounded-none bg-[#b6ff43] text-[#10120e] hover:bg-[#d4ff8a]"
									disabled={submittingTxHash || !txHash.trim()}
									type="submit"
								>
									{submittingTxHash ? (
										<LoaderCircle className="animate-spin" />
									) : (
										<Send />
									)}
									{m.checkout_tx_hash_submit()}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			) : null}
			{showReviewSubmit ? (
				<PaymentReviewDialog
					disabled={order?.review_status === "pending"}
					onSubmitted={onReviewSubmitted}
					orderId={orderId}
					transactionHash={txHash}
				/>
			) : null}
			<div className="flex items-center justify-center gap-1.5 py-1 text-[#9da098]">
				<LoaderCircle className="size-3.5 animate-spin text-[#b6ff43]" />
				<span className="text-xs">{m.checkout_checking()}</span>
			</div>
		</section>
	);
}
