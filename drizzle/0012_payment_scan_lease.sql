ALTER TABLE `orders` ADD `payment_scan_lease_until` integer;--> statement-breakpoint
CREATE INDEX `audit_logs_payment_scan_failure_idx` ON `audit_logs` (`target_id`,`created_at`,`id`) WHERE `audit_logs`.`action` = 'payment.scan_failed' AND `audit_logs`.`target_type` = 'order';--> statement-breakpoint
PRAGMA optimize;
