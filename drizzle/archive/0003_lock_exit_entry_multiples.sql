-- The stop and target multiples become entry facts, stored on the plan.
--
-- Read live from exit_settings, they made "locked at entry" false: editing the
-- global ATR multiple silently repriced the initial stop, R and Target 1 of
-- every plan already open. Defaults match the framework, so existing rows keep
-- the levels they were created with.
ALTER TABLE "exit_rules" ADD COLUMN "entry_stop_atr_multiple" numeric(24, 8) DEFAULT '1.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "exit_rules" ADD COLUMN "entry_target_multiple" numeric(24, 8) DEFAULT '1.5' NOT NULL;
