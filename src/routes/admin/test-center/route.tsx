import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ModuleNavigation } from "#/layouts/settings/module-navigation";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/admin/test-center")({
	component: PaymentTestCenterLayout,
});

function PaymentTestCenterLayout() {
	return (
		<ModuleNavigation
			moduleId="test-center"
			title={m.payment_test_center_title()}
			description={m.payment_test_center_description()}
		>
			<Outlet />
		</ModuleNavigation>
	);
}
