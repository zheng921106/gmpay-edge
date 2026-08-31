export type MerchantPermissionGrant = {
	module: string;
	permissionMask: number;
};

export function hasMerchantPermission(
	permissions: readonly MerchantPermissionGrant[],
	module: string,
	permissionMask: number,
) {
	const granted = permissions.reduce(
		(mask, permission) =>
			permission.module === module ? mask | permission.permissionMask : mask,
		0,
	);
	return (granted & permissionMask) === permissionMask;
}
