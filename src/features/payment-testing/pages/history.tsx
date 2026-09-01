"use client";

import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { ProButton } from "#/components/pro/base/button";
import { ProTable, type ProTableState } from "#/components/pro/table";
import { StatusBadge } from "#/components/status-badge";
import { Badge } from "#/components/ui/badge";
import {
	paymentTestCallbackModeLabel,
	paymentTestModeLabel,
} from "#/features/payment-testing/components/labels";
import { listPaymentTestRunsFn } from "#/features/payment-testing/server/functions";
import { formatDateTime } from "#/lib/format";
import { useCurrentProTableUrlState } from "#/lib/pro-table-url-state";
import { m } from "#/paraglide/messages";

type PaymentTestRunRecord = Awaited<
	ReturnType<typeof listPaymentTestRunsFn>
>["items"][number];

export function PaymentTestHistoryPage() {
	const tableUrlState = useCurrentProTableUrlState();
	const [refreshKey] = useState(0);
	const cursorRef = useRef(
		new Map<number, { createdAt: number; id: string }>(),
	);
	const request = useCallback(async (state: ProTableState) => {
		if (state.pagination.pageIndex === 0) cursorRef.current.clear();
		const result = await listPaymentTestRunsFn({
			data: {
				pageSize: state.pagination.pageSize,
				cursor: cursorRef.current.get(state.pagination.pageIndex),
			},
		});
		if (result.nextCursor)
			cursorRef.current.set(state.pagination.pageIndex + 1, result.nextCursor);
		return { data: result.items, total: result.total };
	}, []);
	const columns = useMemo<ColumnDef<PaymentTestRunRecord>[]>(
		() => [
			{
				accessorKey: "externalOrderId",
				header: m.payment_test_run(),
				cell: ({ row }) => (
					<div className="grid gap-1">
						<strong>{row.original.externalOrderId}</strong>
						<code className="text-xs text-muted-foreground">
							{row.original.id}
						</code>
					</div>
				),
			},
			{
				accessorKey: "status",
				header: m.common_status(),
				cell: ({ row }) => <StatusBadge value={row.original.status} />,
			},
			{
				accessorKey: "protocol",
				header: m.payment_test_protocol(),
				cell: ({ row }) => (
					<Badge variant="outline">{row.original.protocol.toUpperCase()}</Badge>
				),
			},
			{
				accessorKey: "mode",
				header: m.payment_test_mode(),
				cell: ({ row }) => paymentTestModeLabel(row.original.mode),
			},
			{
				accessorKey: "callbackMode",
				header: m.payment_test_callback(),
				cell: ({ row }) =>
					paymentTestCallbackModeLabel(row.original.callbackMode),
			},
			{
				accessorKey: "createdAt",
				header: m.common_created(),
				cell: ({ row }) => formatDateTime(row.original.createdAt),
			},
			{
				id: "actions",
				header: m.common_actions(),
				cell: ({ row }) => (
					<ProButton
						asChild
						size="icon-sm"
						variant="ghost"
						tooltip={m.payment_test_view_evidence()}
					>
						<Link
							to="/admin/test-center/runs/$runId"
							params={{ runId: row.original.id }}
						>
							<ArrowRight />
						</Link>
					</ProButton>
				),
			},
		],
		[],
	);
	return (
		<div className="flex min-h-0 w-full flex-1">
			<ProTable
				className="min-h-0 flex-1"
				columns={columns}
				request={request}
				requestKey={refreshKey}
				initialState={tableUrlState.initialState}
				onChange={tableUrlState.onChange}
			/>
		</div>
	);
}
