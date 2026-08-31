"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Building2, ChevronDown } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	listMerchantContextsFn,
	selectMerchantContextFn,
} from "#/server/merchant-context";
import { useNavigation } from "./navigation-context";
import { m } from "#/paraglide/messages";

export function MerchantContextSelect() {
	const router = useRouter();
	const { merchantContext } = useNavigation();
	const contexts = useQuery({
		queryKey: ["merchant-contexts"],
		queryFn: () => listMerchantContextsFn(),
		enabled: Boolean(merchantContext),
		staleTime: 60_000,
	});
	const select = useMutation({
		mutationFn: async (context: {
			merchantId: string;
			environmentId: string;
			environment: "sandbox" | "production";
		}) => {
			await selectMerchantContextFn({ data: context });
			await router.invalidate();
		},
	});
	if (!merchantContext) return null;
	const selected = contexts.data?.find(
		(context) =>
			context.merchantId === merchantContext.merchantId &&
			context.environmentId === merchantContext.environmentId,
	);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={m.merchant_context_switch()}
					className="hidden h-9 max-w-52 justify-start gap-2 px-2 sm:flex"
					disabled={contexts.isLoading || select.isPending}
					variant="outline"
				>
					<Building2 className="size-4 shrink-0" />
					<span className="min-w-0 truncate text-left text-sm">
						{selected?.merchantName ?? m.merchant_context_loading()}
					</span>
					<span className="text-muted-foreground text-xs">
						{environmentLabel(merchantContext.environment)}
					</span>
					<ChevronDown className="size-4 shrink-0" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-64">
				<DropdownMenuLabel>{m.merchant_context_switch()}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{contexts.data?.map((context) => (
					<DropdownMenuCheckboxItem
						checked={
							context.merchantId === merchantContext.merchantId &&
							context.environmentId === merchantContext.environmentId
						}
						disabled={select.isPending}
						key={context.environmentId}
						onSelect={(event) => {
							event.preventDefault();
							select.mutate(context);
						}}
					>
						<span className="min-w-0 flex-1 truncate">
							{context.merchantName}
						</span>
						<span className="text-muted-foreground text-xs">
							{environmentLabel(context.environment)}
						</span>
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function environmentLabel(value: "sandbox" | "production") {
	return value === "production"
		? m.merchant_environment_production()
		: m.merchant_environment_sandbox();
}
