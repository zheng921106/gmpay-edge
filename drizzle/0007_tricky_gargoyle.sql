CREATE TABLE `merchant_environments` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_environments_merchant_code_uidx` ON `merchant_environments` (`merchant_id`,`code`);--> statement-breakpoint
CREATE INDEX `merchant_environments_status_idx` ON `merchant_environments` (`status`,`id`);--> statement-breakpoint
CREATE TABLE `merchant_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by_user_id` text,
	`invited_at` integer,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_memberships_merchant_user_uidx` ON `merchant_memberships` (`merchant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `merchant_memberships_user_idx` ON `merchant_memberships` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `merchant_memberships_merchant_idx` ON `merchant_memberships` (`merchant_id`,`status`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_slug_uidx` ON `merchants` (`slug`);--> statement-breakpoint
CREATE INDEX `merchants_status_idx` ON `merchants` (`status`,`id`);--> statement-breakpoint
INSERT OR IGNORE INTO `merchants` (`id`, `slug`, `name`, `status`, `created_at`, `updated_at`)
VALUES ('default-merchant', 'default', 'Default Merchant', 'active', unixepoch() * 1000, unixepoch() * 1000);--> statement-breakpoint
INSERT OR IGNORE INTO `merchant_environments` (`id`, `merchant_id`, `code`, `status`, `created_at`, `updated_at`)
VALUES ('default-sandbox', 'default-merchant', 'sandbox', 'active', unixepoch() * 1000, unixepoch() * 1000);--> statement-breakpoint
INSERT OR IGNORE INTO `merchant_environments` (`id`, `merchant_id`, `code`, `status`, `created_at`, `updated_at`)
VALUES ('default-production', 'default-merchant', 'production', 'active', unixepoch() * 1000, unixepoch() * 1000);--> statement-breakpoint
INSERT OR IGNORE INTO `merchant_memberships` (`id`, `merchant_id`, `user_id`, `status`, `accepted_at`, `created_at`, `updated_at`)
SELECT 'default-membership-' || `id`, 'default-merchant', `id`, 'active', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000
FROM `users` WHERE `enabled` = 1;--> statement-breakpoint
DROP INDEX `roles_name_uidx`;--> statement-breakpoint
ALTER TABLE `roles` ADD `merchant_id` text REFERENCES merchants(id);--> statement-breakpoint
CREATE UNIQUE INDEX `roles_merchant_name_uidx` ON `roles` (`merchant_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `roles_global_name_uidx` ON `roles` (`name`) WHERE "roles"."merchant_id" IS NULL;--> statement-breakpoint
CREATE INDEX `roles_merchant_idx` ON `roles` (`merchant_id`);
