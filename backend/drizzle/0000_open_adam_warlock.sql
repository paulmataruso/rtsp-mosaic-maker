CREATE TABLE `cameras` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`host` text NOT NULL,
	`main_rtsp_url` text NOT NULL,
	`sub_rtsp_url` text,
	`username` text DEFAULT '' NOT NULL,
	`encrypted_password` text,
	`transport` text DEFAULT 'tcp' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`onvif_host` text,
	`onvif_port` integer,
	`onvif_profile_token` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cameras_name_idx` ON `cameras` (`name`);--> statement-breakpoint
CREATE TABLE `mediamtx_managed_paths` (
	`slug` text PRIMARY KEY NOT NULL,
	`mosaic_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_reconciled_at` text,
	FOREIGN KEY (`mosaic_id`) REFERENCES `mosaics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mosaic_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`mosaic_id` text NOT NULL,
	`position` integer NOT NULL,
	`camera_id` text,
	`stream_type` text DEFAULT 'sub' NOT NULL,
	`fit_mode` text DEFAULT 'letterbox' NOT NULL,
	`label` text,
	`label_enabled` integer DEFAULT true NOT NULL,
	`label_position` text DEFAULT 'bottom-left' NOT NULL,
	`label_font_size` integer DEFAULT 20 NOT NULL,
	`label_bg_opacity` real DEFAULT 0.45 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`mosaic_id`) REFERENCES `mosaics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mosaic_cells_pos_unique` ON `mosaic_cells` (`mosaic_id`,`position`);--> statement-breakpoint
CREATE INDEX `mosaic_cells_mosaic_idx` ON `mosaic_cells` (`mosaic_id`);--> statement-breakpoint
CREATE TABLE `mosaics` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`slug` text NOT NULL,
	`rows` integer NOT NULL,
	`cols` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`fps` integer NOT NULL,
	`video_bitrate_kbps` integer NOT NULL,
	`codec` text DEFAULT 'h264' NOT NULL,
	`encoder` text DEFAULT 'libx264' NOT NULL,
	`gop_seconds` real DEFAULT 2 NOT NULL,
	`background_color` text DEFAULT 'black' NOT NULL,
	`auto_start` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mosaics_slug_unique` ON `mosaics` (`slug`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
