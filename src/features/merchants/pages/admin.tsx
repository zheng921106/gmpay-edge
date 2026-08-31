"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { ProButton } from "#/components/pro/base/button";
import { ModalForm } from "#/components/pro/form";
import { Badge } from "#/components/ui/badge";
import { Switch } from "#/components/ui/switch";
import {
	createPlatformMerchantFn,
	listPlatformMerchantsFn,
	setPlatformEnvironmentStatusFn,
	setPlatformMerchantStatusFn,
} from "#/features/merchants/server/admin";
import { Main } from "#/layouts/components/main";
import { PageHeader } from "#/layouts/components/page-header";
import { m } from "#/paraglide/messages";

const merchantQueryKey = ["platform-merchants"] as const;

export function MerchantAdminPage() {
	const queryClient = useQueryClient();
	const merchants = useQuery({
		queryKey: merchantQueryKey,
		queryFn: () => listPlatformMerchantsFn(),
	});
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: merchantQueryKey });
	const create = useMutation({
		mutationFn: createPlatformMerchantFn,
		onSuccess: async () => {
			await invalidate();
			toast.success(m.merchant_admin_created());
		},
		onError: () => toast.error(m.merchant_admin_failed()),
	});
	const merchantStatus = useMutation({
		mutationFn: setPlatformMerchantStatusFn,
		onSuccess: invalidate,
		onError: () => toast.error(m.merchant_admin_failed()),
	});
	const environmentStatus = useMutation({
		mutationFn: setPlatformEnvironmentStatusFn,
		onSuccess: invalidate,
		onError: () => toast.error(m.merchant_admin_failed()),
	});
	return (
		<Main fixed className="gap-4">
			<PageHeader
				title={m.merchant_admin_title()}
				description={m.merchant_admin_description()}
				actions={
					<ModalForm
						title={m.merchant_admin_create()}
						schema={merchantSchema}
						onFinish={async (values) => {
							await create.mutateAsync({
								data: {
									name: String(values.name ?? ""),
									slug: String(values.slug ?? ""),
									ownerEmail: String(values.ownerEmail ?? ""),
								},
							});
						}}
						trigger={
							<ProButton>
								<Building2 />
								{m.merchant_admin_create()}
							</ProButton>
						}
					/>
				}
			/>
			<section className="min-h-0 overflow-auto border bg-card">
				<table className="w-full text-left text-sm">
					<caption className="sr-only">{m.merchant_admin_title()}</caption>
					<thead className="border-b bg-muted/30 text-muted-foreground text-xs">
						<tr>
							<th className="px-4 py-3 font-medium">{m.common_name()}</th>
							<th className="px-4 py-3 font-medium">
								{m.merchant_members_title()}
							</th>
							<th className="px-4 py-3 font-medium">
								{m.merchant_environment_sandbox()}
							</th>
							<th className="px-4 py-3 font-medium">
								{m.merchant_environment_production()}
							</th>
							<th className="px-4 py-3 font-medium">{m.common_status()}</th>
						</tr>
					</thead>
					<tbody>
						{merchants.data?.map((merchant) => (
							<tr className="border-b last:border-0" key={merchant.id}>
								<td className="px-4 py-3">
									<strong className="block font-medium">{merchant.name}</strong>
									<code className="text-muted-foreground text-xs">
										{merchant.slug}
									</code>
								</td>
								<td className="px-4 py-3">{merchant.memberCount}</td>
								<td className="px-4 py-3">
									<Switch
										aria-label={m.merchant_environment_sandbox()}
										checked={merchant.environments.sandboxActive}
										disabled={environmentStatus.isPending}
										onCheckedChange={(checked) =>
											environmentStatus.mutate({
												data: {
													merchantId: merchant.id,
													environment: "sandbox",
													status: checked ? "active" : "suspended",
												},
											})
										}
									/>
								</td>
								<td className="px-4 py-3">
									<Switch
										aria-label={m.merchant_environment_production()}
										checked={merchant.environments.productionActive}
										disabled={environmentStatus.isPending}
										onCheckedChange={(checked) =>
											environmentStatus.mutate({
												data: {
													merchantId: merchant.id,
													environment: "production",
													status: checked ? "active" : "suspended",
												},
											})
										}
									/>
								</td>
								<td className="px-4 py-3">
									<div className="flex items-center gap-3">
										<Switch
											aria-label={m.common_status()}
											checked={merchant.status === "active"}
											disabled={merchantStatus.isPending}
											onCheckedChange={(checked) =>
												merchantStatus.mutate({
													data: {
														merchantId: merchant.id,
														status: checked ? "active" : "suspended",
													},
												})
											}
										/>
										<Badge
											variant={
												merchant.status === "active" ? "default" : "secondary"
											}
										>
											{merchant.status}
										</Badge>
									</div>
								</td>
							</tr>
						))}
						{merchants.isLoading ? (
							<tr>
								<td className="px-4 py-8 text-muted-foreground" colSpan={5}>
									{m.common_loading()}
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</section>
		</Main>
	);
}

const merchantSchema = [
	{ name: "name", label: m.common_name(), required: true },
	{ name: "slug", label: m.auth_sign_up_merchant_slug(), required: true },
	{
		name: "ownerEmail",
		label: m.merchant_admin_owner_email(),
		valueType: "email" as const,
		required: true,
	},
];
