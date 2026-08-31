DROP INDEX `api_keys_created_idx`;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `merchant_id` text REFERENCES merchants(id);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `environment_id` text REFERENCES merchant_environments(id);--> statement-breakpoint
CREATE INDEX `api_keys_merchant_environment_idx` ON `api_keys` (`merchant_id`,`environment_id`,`created_at`,`id`);--> statement-breakpoint
UPDATE `api_keys`
SET `merchant_id` = 'default-merchant', `environment_id` = 'default-production'
WHERE `merchant_id` IS NULL OR `environment_id` IS NULL;--> statement-breakpoint
DROP INDEX `idempotency_key_uidx`;--> statement-breakpoint
DROP INDEX `idempotency_keys_expires_idx`;--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD `merchant_id` text REFERENCES merchants(id);--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD `environment_id` text REFERENCES merchant_environments(id);--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_merchant_environment_key_uidx` ON `idempotency_keys` (`merchant_id`,`environment_id`,`key`);--> statement-breakpoint
CREATE INDEX `idempotency_keys_expires_idx` ON `idempotency_keys` (`merchant_id`,`environment_id`,`expires_at`);--> statement-breakpoint
UPDATE `idempotency_keys`
SET `merchant_id` = 'default-merchant', `environment_id` = 'default-production'
WHERE `merchant_id` IS NULL OR `environment_id` IS NULL;--> statement-breakpoint
DROP INDEX `orders_api_key_external_id_uidx`;--> statement-breakpoint
DROP INDEX `orders_internal_external_id_uidx`;--> statement-breakpoint
DROP INDEX `orders_created_at_idx`;--> statement-breakpoint
ALTER TABLE `orders` ADD `merchant_id` text REFERENCES merchants(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `environment_id` text REFERENCES merchant_environments(id);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_merchant_environment_api_key_external_id_uidx` ON `orders` (`merchant_id`,`environment_id`,`api_key_id`,`external_order_id`) WHERE "orders"."api_key_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_merchant_environment_external_id_uidx` ON `orders` (`merchant_id`,`environment_id`,`external_order_id`) WHERE "orders"."api_key_id" IS NULL;--> statement-breakpoint
CREATE INDEX `orders_merchant_environment_created_at_idx` ON `orders` (`merchant_id`,`environment_id`,`created_at`,`id`);--> statement-breakpoint
UPDATE `orders`
SET `merchant_id` = 'default-merchant', `environment_id` = 'default-production'
WHERE `merchant_id` IS NULL OR `environment_id` IS NULL;--> statement-breakpoint
DROP INDEX `receiving_methods_rail_target_uidx`;--> statement-breakpoint
ALTER TABLE `receiving_methods` ADD `merchant_id` text REFERENCES merchants(id);--> statement-breakpoint
ALTER TABLE `receiving_methods` ADD `environment_id` text REFERENCES merchant_environments(id);--> statement-breakpoint
CREATE UNIQUE INDEX `receiving_methods_merchant_environment_target_uidx` ON `receiving_methods` (`merchant_id`,`environment_id`,`rail_code`,`normalized_target_value`);--> statement-breakpoint
UPDATE `receiving_methods`
SET `merchant_id` = 'default-merchant', `environment_id` = 'default-production'
WHERE `merchant_id` IS NULL OR `environment_id` IS NULL;--> statement-breakpoint
DROP INDEX `payment_ingresses_provider_network_uidx`;--> statement-breakpoint
DROP INDEX `payment_ingresses_external_uidx`;--> statement-breakpoint
ALTER TABLE `payment_ingresses` ADD `merchant_id` text REFERENCES merchants(id);--> statement-breakpoint
ALTER TABLE `payment_ingresses` ADD `environment_id` text REFERENCES merchant_environments(id);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_ingresses_provider_network_uidx` ON `payment_ingresses` (`merchant_id`,`environment_id`,`provider`,`network`) WHERE "payment_ingresses"."type" = 'provider_webhook';--> statement-breakpoint
CREATE UNIQUE INDEX `payment_ingresses_external_uidx` ON `payment_ingresses` (`merchant_id`,`environment_id`,`provider`,`external_source_id`) WHERE "payment_ingresses"."type" = 'provider_webhook';
--> statement-breakpoint
UPDATE `payment_ingresses`
SET `merchant_id` = 'default-merchant', `environment_id` = 'default-production'
WHERE `merchant_id` IS NULL OR `environment_id` IS NULL;
