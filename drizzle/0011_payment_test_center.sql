ALTER TABLE `payment_rails` ADD `network_class` text DEFAULT 'mainnet' NOT NULL CHECK (`network_class` IN ('mainnet', 'testnet', 'simulated'));--> statement-breakpoint
INSERT OR IGNORE INTO `payment_rails` (`code`, `name`, `kind`, `network_class`, `adapter`, `metadata`, `created_at`, `updated_at`) VALUES
	('simulator', 'Payment Simulator', 'chain', 'simulated', 'simulator', '{"family":"simulator","nativeSymbol":"USDT"}', unixepoch() * 1000, unixepoch() * 1000),
	('tron-nile', 'TRON Nile', 'chain', 'testnet', 'tron', '{"family":"tron","nativeSymbol":"TRX"}', unixepoch() * 1000, unixepoch() * 1000),
	('ethereum-sepolia', 'Ethereum Sepolia', 'chain', 'testnet', 'evm', '{"family":"evm","nativeSymbol":"ETH"}', unixepoch() * 1000, unixepoch() * 1000),
	('base-sepolia', 'Base Sepolia', 'chain', 'testnet', 'evm', '{"family":"evm","nativeSymbol":"ETH"}', unixepoch() * 1000, unixepoch() * 1000),
	('bsc-testnet', 'BNB Smart Chain Testnet', 'chain', 'testnet', 'evm', '{"family":"evm","nativeSymbol":"BNB"}', unixepoch() * 1000, unixepoch() * 1000),
	('polygon-amoy', 'Polygon Amoy', 'chain', 'testnet', 'evm', '{"family":"evm","nativeSymbol":"POL"}', unixepoch() * 1000, unixepoch() * 1000);--> statement-breakpoint
INSERT OR IGNORE INTO `payment_assets` (`id`, `rail_code`, `code`, `symbol`, `kind`, `contract_address`, `decimals`, `default_confirmations`, `created_at`, `updated_at`) VALUES
	('simulator-usdt', 'simulator', 'USDT', 'USDT', 'native', NULL, 6, 1, unixepoch() * 1000, unixepoch() * 1000),
	('tron-nile-trx', 'tron-nile', 'TRX', 'TRX', 'native', NULL, 6, 1, unixepoch() * 1000, unixepoch() * 1000),
	('ethereum-sepolia-eth', 'ethereum-sepolia', 'ETH', 'ETH', 'native', NULL, 18, 1, unixepoch() * 1000, unixepoch() * 1000),
	('base-sepolia-eth', 'base-sepolia', 'ETH', 'ETH', 'native', NULL, 18, 1, unixepoch() * 1000, unixepoch() * 1000),
	('bsc-testnet-bnb', 'bsc-testnet', 'BNB', 'BNB', 'native', NULL, 18, 1, unixepoch() * 1000, unixepoch() * 1000),
	('polygon-amoy-pol', 'polygon-amoy', 'POL', 'POL', 'native', NULL, 18, 1, unixepoch() * 1000, unixepoch() * 1000);--> statement-breakpoint
CREATE TABLE `payment_test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`protocol` text NOT NULL CHECK (`protocol` IN ('gmpay', 'epay')),
	`payment_mode` text NOT NULL CHECK (`payment_mode` IN ('simulator', 'testnet', 'live')),
	`api_key_id` text NOT NULL,
	`external_order_id` text NOT NULL,
	`order_id` text,
	`callback_mode` text NOT NULL CHECK (`callback_mode` IN ('builtin', 'custom')),
	`callback_destination_snapshot` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL CHECK (`status` IN ('ready', 'running', 'passed', 'failed', 'cancelled', 'expired')),
	`expected_outcome` text DEFAULT 'paid' NOT NULL CHECK (`expected_outcome` IN ('paid', 'partial', 'overpaid', 'failed_payment', 'late_payment', 'reorg_recovered', 'callback_retry_succeeded')),
	`idempotency_key` text NOT NULL,
	`scenario` text,
	`scenario_step` integer DEFAULT 0 NOT NULL,
	`request_snapshot` text,
	`response_snapshot` text,
	`confirmation_nonce_hash` text,
	`confirmation_expires_at` integer,
	`confirmation_consumed_at` integer,
	`callback_token_hash` text,
	`callback_token_expires_at` integer,
	`failure_code` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `merchant_environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `payment_test_runs_snapshot_size_check` CHECK ((`request_snapshot` IS NULL OR length(`request_snapshot`) <= 65536) AND (`response_snapshot` IS NULL OR length(`response_snapshot`) <= 65536))
);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_test_runs_scope_idempotency_uidx` ON `payment_test_runs` (`merchant_id`,`environment_id`,`protocol`,`api_key_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_test_runs_order_uidx` ON `payment_test_runs` (`order_id`) WHERE `order_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `payment_test_runs_history_idx` ON `payment_test_runs` (`merchant_id`,`environment_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `payment_test_runs_active_idx` ON `payment_test_runs` (`merchant_id`,`environment_id`,`created_at`,`id`) WHERE `status` IN ('ready', 'running');--> statement-breakpoint
CREATE INDEX `payment_test_runs_retention_idx` ON `payment_test_runs` (`completed_at`,`id`) WHERE `status` IN ('passed', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE `payment_test_callback_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`event_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`signature_status` text NOT NULL CHECK (`signature_status` IN ('valid', 'invalid')),
	`request_headers` text NOT NULL,
	`request_body` text NOT NULL,
	`response_acknowledgement` text NOT NULL,
	`received_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `payment_test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `webhook_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_id`) REFERENCES `webhook_deliveries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `payment_test_callback_receipts_size_check` CHECK (length(`request_headers`) <= 16384 AND length(`request_body`) <= 65536)
);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_test_callback_receipts_delivery_attempt_uidx` ON `payment_test_callback_receipts` (`delivery_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `payment_test_callback_receipts_run_received_idx` ON `payment_test_callback_receipts` (`run_id`,`received_at`,`id`);--> statement-breakpoint
CREATE INDEX `payment_test_callback_receipts_retention_idx` ON `payment_test_callback_receipts` (`received_at`,`id`);--> statement-breakpoint
PRAGMA optimize;
