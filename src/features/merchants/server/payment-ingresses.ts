import {
	initialPaymentConnections,
	initialPaymentRails,
} from "#/features/payment-settings/catalog";

export type MerchantIngressEnvironment = {
	id: string;
	code: "sandbox" | "production";
};

export type MerchantPaymentIngress = {
	id: string;
	merchantId: string;
	environmentId: string;
	railCode: string;
	name: string;
	type: "rpc" | "provider";
	transport: "http" | "websocket";
	endpoint: string | null;
	apiKey: null;
	priority: number;
	enabled: boolean;
	healthStatus: "unknown";
	createdAt: Date;
	updatedAt: Date;
};

export function merchantPaymentIngressValues(input: {
	merchantId: string;
	environments: readonly MerchantIngressEnvironment[];
	now: Date;
}): MerchantPaymentIngress[] {
	return input.environments.flatMap((environment) =>
		initialPaymentConnections
			.filter((connection) => {
				const networkClass = initialPaymentRails.find(
					(rail) => rail.code === connection.railCode,
				)?.networkClass;
				return environment.code === "production"
					? networkClass === "mainnet"
					: networkClass === "testnet" || networkClass === "simulated";
			})
			.map((connection) => ({
				id: defaultIngressId(input.merchantId, environment.id, connection.id),
				merchantId: input.merchantId,
				environmentId: environment.id,
				railCode: connection.railCode,
				name: connection.name,
				type: connection.type,
				transport: "transport" in connection ? connection.transport : "http",
				endpoint: connection.endpoint,
				apiKey: null,
				priority: connection.priority,
				enabled: connection.enabled,
				healthStatus: connection.healthStatus,
				createdAt: input.now,
				updatedAt: input.now,
			})),
	);
}

export function merchantPaymentIngressInsertStatement(
	database: D1Database,
	ingress: MerchantPaymentIngress,
	ignoreExisting = false,
) {
	return database
		.prepare(
			`INSERT ${ignoreExisting ? "OR IGNORE " : ""}INTO payment_ingresses
			 (id, merchant_id, environment_id, rail_code, name, type, transport,
			  endpoint, api_key, priority, enabled, health_status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			ingress.id,
			ingress.merchantId,
			ingress.environmentId,
			ingress.railCode,
			ingress.name,
			ingress.type,
			ingress.transport,
			ingress.endpoint,
			ingress.apiKey,
			ingress.priority,
			ingress.enabled,
			ingress.healthStatus,
			ingress.createdAt.getTime(),
			ingress.updatedAt.getTime(),
		);
}

function defaultIngressId(
	merchantId: string,
	environmentId: string,
	connectionId: string,
) {
	if (
		merchantId === "default-merchant" &&
		environmentId === "default-production"
	)
		return connectionId;
	return `${environmentId}:${connectionId}`;
}
