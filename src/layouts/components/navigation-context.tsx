import { createContext, useContext } from "react";
import type { MerchantPermissionGrant } from "#/features/access/merchant-rbac";
import type { SystemPermissionGrant } from "#/features/access/system-rbac";
import type { SidebarData } from "./types";

type NavigationContextValue = {
	navigation: SidebarData;
	permissions: readonly SystemPermissionGrant[];
	merchantPermissions?: readonly MerchantPermissionGrant[];
	merchantContext?: {
		merchantId: string;
		environmentId: string;
		environment: "sandbox" | "production";
	};
};

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({
	children,
	navigation,
	permissions,
	merchantPermissions,
	merchantContext,
}: NavigationContextValue & { children: React.ReactNode }) {
	return (
		<NavigationContext
			value={{ navigation, permissions, merchantPermissions, merchantContext }}
		>
			{children}
		</NavigationContext>
	);
}

export function useNavigation() {
	const value = useContext(NavigationContext);
	if (!value)
		throw new Error("useNavigation must be used within NavigationProvider");
	return value;
}
