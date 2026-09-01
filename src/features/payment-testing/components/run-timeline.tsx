import {
	Activity,
	BellRing,
	CircleDollarSign,
	FileCheck2,
	ReceiptText,
	Send,
	Webhook,
} from "lucide-react";
import type { ComponentType } from "react";
import { statusLabel } from "#/components/status-badge";
import type { PaymentTestTimelineEvent } from "#/features/payment-testing/server/timeline";
import { formatDateTime } from "#/lib/format";
import { m } from "#/paraglide/messages";

const eventIcons: Record<
	PaymentTestTimelineEvent["kind"],
	ComponentType<{ className?: string }>
> = {
	"run.created": Activity,
	"order.created": ReceiptText,
	"payment.observed": CircleDollarSign,
	"webhook.event": BellRing,
	"webhook.delivery": Send,
	"webhook.attempt": Webhook,
	"callback.received": FileCheck2,
	"audit.recorded": FileCheck2,
};

export function RunTimeline({
	events,
}: {
	events: readonly PaymentTestTimelineEvent[];
}) {
	if (!events.length)
		return (
			<div className="border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
				{m.payment_test_timeline_empty()}
			</div>
		);
	return (
		<ol
			className="relative space-y-0"
			aria-label={m.payment_test_timeline_title()}
		>
			{events.map((event, index) => {
				const Icon = eventIcons[event.kind];
				return (
					<li
						key={event.id}
						data-event-kind={event.kind}
						className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0"
					>
						{index < events.length - 1 ? (
							<span className="absolute top-9 bottom-0 left-[1.1rem] w-px bg-border" />
						) : null}
						<span className="relative z-10 flex size-9 items-center justify-center border bg-background text-foreground">
							<Icon className="size-4" />
						</span>
						<div className="min-w-0 border-b pb-5 last:border-b-0">
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<strong className="text-sm">
									{eventKindLabel(event.kind)}
								</strong>
								<time className="text-xs text-muted-foreground">
									{formatDateTime(event.occurredAt)}
								</time>
							</div>
							{event.status ? (
								<p className="mt-1 text-xs font-medium text-muted-foreground">
									{statusLabel(event.status)}
								</p>
							) : null}
							{event.detail !== null ? (
								<pre className="mt-3 max-h-40 overflow-auto border bg-muted/35 p-3 font-mono text-xs leading-5 whitespace-pre-wrap">
									{JSON.stringify(event.detail, null, 2)}
								</pre>
							) : null}
						</div>
					</li>
				);
			})}
		</ol>
	);
}

function eventKindLabel(kind: PaymentTestTimelineEvent["kind"]) {
	const labels = {
		"run.created": m.payment_test_event_run_created(),
		"order.created": m.payment_test_event_order_created(),
		"payment.observed": m.payment_test_event_payment_observed(),
		"webhook.event": m.payment_test_event_webhook_event(),
		"webhook.delivery": m.payment_test_event_webhook_delivery(),
		"webhook.attempt": m.payment_test_event_webhook_attempt(),
		"callback.received": m.payment_test_event_callback_received(),
		"audit.recorded": m.payment_test_event_audit_recorded(),
	} satisfies Record<PaymentTestTimelineEvent["kind"], string>;
	return labels[kind];
}
