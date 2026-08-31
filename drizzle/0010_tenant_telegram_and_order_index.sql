ALTER TABLE `telegram_bots` ADD `merchant_id` text NOT NULL DEFAULT 'default-merchant';--> statement-breakpoint
ALTER TABLE `telegram_bots` ADD `environment_id` text NOT NULL DEFAULT 'default-production';--> statement-breakpoint
CREATE INDEX `telegram_bots_merchant_environment_created_idx` ON `telegram_bots` (`merchant_id`,`environment_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `orders_created_at_idx` ON `orders` (`created_at`,`id`);
