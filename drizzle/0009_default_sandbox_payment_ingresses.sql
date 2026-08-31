INSERT OR IGNORE INTO `payment_ingresses`
	(`id`, `merchant_id`, `environment_id`, `rail_code`, `name`, `type`, `transport`,
	 `endpoint`, `api_key`, `priority`, `enabled`, `health_status`, `created_at`, `updated_at`)
SELECT
	'default-sandbox:' || `id`,
	'default-merchant',
	'default-sandbox',
	`rail_code`,
	`name`,
	`type`,
	`transport`,
	`endpoint`,
	NULL,
	`priority`,
	`enabled`,
	`health_status`,
	`created_at`,
	`updated_at`
FROM `payment_ingresses`
WHERE `merchant_id` = 'default-merchant'
	AND `environment_id` = 'default-production'
	AND `type` IN ('rpc', 'provider');
