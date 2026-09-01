import { m } from "#/paraglide/messages";

export function paymentTestOperationErrorMessage(error: unknown) {
	if (paymentTestRequiresReceivingMethodConfiguration(error))
		return m.payment_test_error_receiving_target_invalid();
	const code = errorCode(error);
	switch (code) {
		case "invalid_input":
		case "payment_test_raw_input_mismatch":
			return m.payment_test_error_invalid_input();
		case "unauthorized":
		case "forbidden":
			return m.payment_test_error_permission_denied();
		case "payment_test_resource_not_found":
		case "payment_test_scope_unavailable":
		case "payment_test_credential_unavailable":
		case "payment_test_scope_missing":
		case "payment_mode_environment_mismatch":
		case "payment_rail_class_mismatch":
		case "payment_test_method_not_ready":
		case "payment_test_callback_unsafe":
			return m.payment_test_error_configuration_required();
		case "payment_test_queue_unavailable":
			return m.payment_test_error_queue_unavailable();
	}
	switch (errorMessage(error)) {
		case "Invalid request":
		case "Payment test input is invalid.":
			return m.payment_test_error_invalid_input();
		case "Unauthorized":
		case "Forbidden":
			return m.payment_test_error_permission_denied();
		case "Required payment test queues are unavailable.":
			return m.payment_test_error_queue_unavailable();
		case "Payment test resources were not found.":
		case "Payment test scope is unavailable.":
		case "Payment test credential is unavailable.":
		case "The selected credential cannot create orders.":
		case "The payment mode is not available in this environment.":
		case "The payment rail does not support the selected mode.":
		case "Receiving method is not ready.":
		case "The callback URL is not a safe public HTTPS endpoint.":
			return m.payment_test_error_configuration_required();
		default:
			return m.payment_test_operation_failed();
	}
}

export function paymentTestRequiresReceivingMethodConfiguration(
	error: unknown,
) {
	return errorMessage(error) === "The receiving target is invalid.";
}

function errorCode(error: unknown) {
	if (!error || typeof error !== "object" || !("code" in error)) return null;
	return typeof error.code === "string" ? error.code : null;
}

function errorMessage(error: unknown) {
	if (!error || typeof error !== "object" || !("message" in error)) return null;
	return typeof error.message === "string" ? error.message : null;
}
