"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ProButton } from "#/components/pro/base/button";
import { ModalForm } from "#/components/pro/form";
import { Badge } from "#/components/ui/badge";
import { hasMerchantPermission } from "#/features/access/merchant-rbac";
import {
	listMerchantMembersFn,
	upsertMerchantMemberFn,
} from "#/features/merchants/server/admin";
import { Main } from "#/layouts/components/main";
import { useNavigation } from "#/layouts/components/navigation-context";
import { PageHeader } from "#/layouts/components/page-header";
import { m } from "#/paraglide/messages";

const memberQueryKey = ["merchant-members"] as const;

export function MerchantMembersPage() {
	const queryClient = useQueryClient();
	const { merchantPermissions = [] } = useNavigation();
	const canAdd = hasMerchantPermission(merchantPermissions, "merchant", 2);
	const members = useQuery({
		queryKey: memberQueryKey,
		queryFn: () => listMerchantMembersFn(),
	});
	const upsert = useMutation({
		mutationFn: upsertMerchantMemberFn,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: memberQueryKey });
			toast.success(m.merchant_members_added());
		},
		onError: () => toast.error(m.merchant_members_failed()),
	});
	return (
		<Main fixed className="gap-4">
			<PageHeader
				title={m.merchant_members_title()}
				description={m.merchant_members_description()}
				actions={
					canAdd ? (
						<ModalForm
							title={m.merchant_members_add()}
							schema={memberSchema}
							initialValues={{ roleName: "operator" }}
							onFinish={async (values) => {
								await upsert.mutateAsync({
									data: {
										email: String(values.email ?? ""),
										roleName: roleName(values.roleName),
									},
								});
							}}
							trigger={
								<ProButton>
									<UserPlus />
									{m.merchant_members_add()}
								</ProButton>
							}
						/>
					) : undefined
				}
			/>
			<section className="min-h-0 overflow-auto border bg-card">
				<table className="w-full text-left text-sm">
					<caption className="sr-only">{m.merchant_members_title()}</caption>
					<thead className="border-b bg-muted/30 text-muted-foreground text-xs">
						<tr>
							<th className="px-4 py-3 font-medium">{m.common_email()}</th>
							<th className="px-4 py-3 font-medium">
								{m.merchant_members_role()}
							</th>
							<th className="px-4 py-3 font-medium">{m.common_status()}</th>
						</tr>
					</thead>
					<tbody>
						{members.data?.map((member) => (
							<tr className="border-b last:border-0" key={member.userId}>
								<td className="px-4 py-3">
									<strong className="block font-medium">{member.name}</strong>
									<span className="text-muted-foreground">{member.email}</span>
								</td>
								<td className="px-4 py-3">
									<Badge variant="outline">{member.roleName}</Badge>
								</td>
								<td className="px-4 py-3">
									<Badge
										variant={
											member.status === "active" ? "default" : "secondary"
										}
									>
										{member.status}
									</Badge>
								</td>
							</tr>
						))}
						{members.isLoading ? (
							<tr>
								<td className="px-4 py-8 text-muted-foreground" colSpan={3}>
									{m.common_loading()}
								</td>
							</tr>
						) : null}
						{members.data?.length === 0 ? (
							<tr>
								<td className="px-4 py-8 text-muted-foreground" colSpan={3}>
									{m.merchant_members_empty()}
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</section>
		</Main>
	);
}

const memberSchema = [
	{
		name: "email",
		label: m.common_email(),
		valueType: "email" as const,
		required: true,
	},
	{
		name: "roleName",
		label: m.merchant_members_role(),
		valueType: "select" as const,
		required: true,
		fieldProps: {
			options: [
				{ label: "Admin", value: "admin" },
				{ label: "Operator", value: "operator" },
				{ label: "Viewer", value: "viewer" },
			],
		},
	},
];

function roleName(value: unknown): "admin" | "operator" | "viewer" {
	return value === "admin" || value === "viewer" ? value : "operator";
}
