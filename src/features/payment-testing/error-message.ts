import { m } from "#/paraglide/messages";

export function paymentTestOperationErrorMessage(error: unknown) {
	if (!error || typeof error !== "object" || !("code" in error))
		return m.payment_test_operation_failed();
	switch (error.code) {
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
		default:
			return m.payment_test_operation_failed();
	}
}
