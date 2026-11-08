CREATE TABLE `render_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`config_json` text NOT NULL,
	`config_hash` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`mp4_key` text,
	`mov_key` text,
	`mp4_bytes` integer,
	`mov_bytes` integer,
	`error_code` text,
	`error_message` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`expires_at` text,
	`expired` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `render_jobs_owner_created_idx` ON `render_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `render_jobs_status_idx` ON `render_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `render_jobs_owner_hash_idx` ON `render_jobs` (`owner_id`,`config_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `render_jobs_owner_idem_uq` ON `render_jobs` (`owner_id`,`idempotency_key`);