CREATE TYPE "public"."journal_image_phase" AS ENUM('PLAN', 'ENTRY', 'DURING', 'EXIT');--> statement-breakpoint
CREATE TYPE "public"."journal_kind" AS ENUM('REAL', 'PAPER');--> statement-breakpoint
CREATE TYPE "public"."journal_leg_side" AS ENUM('ENTRY', 'EXIT');--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"setup_id" text,
	"kind" "journal_kind" NOT NULL,
	"instrument_id" text NOT NULL,
	"account_type" "account_type",
	"entry_date" date NOT NULL,
	"anchor_trade_id" text,
	"stop_price" numeric(24, 8),
	"target1_price" numeric(24, 8),
	"extra_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"account_equity" numeric(24, 8),
	"risk_rating_override" smallint,
	"criteria_met" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mistakes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lessons" text DEFAULT '' NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_images" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"journal_id" text NOT NULL,
	"leg_id" text,
	"phase" "journal_image_phase" NOT NULL,
	"timeframe" varchar(8),
	"caption" text DEFAULT '' NOT NULL,
	"pathname" text NOT NULL,
	"thumb_pathname" text,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"journal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"side" "journal_leg_side" NOT NULL,
	"date" date NOT NULL,
	"first_trade_id" text,
	"executed_at" timestamp with time zone,
	"price" numeric(24, 8),
	"quantity" numeric(24, 8),
	"fee" numeric(24, 8),
	"rating" smallint,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setups" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exit_rules" ADD COLUMN "target1_override" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "exit_rules" ADD COLUMN "journal_id" text;--> statement-breakpoint
ALTER TABLE "exit_settings" ADD COLUMN "account_equity" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_setup_id_setups_id_fk" FOREIGN KEY ("setup_id") REFERENCES "public"."setups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_anchor_trade_id_trades_id_fk" FOREIGN KEY ("anchor_trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_images" ADD CONSTRAINT "journal_images_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_images" ADD CONSTRAINT "journal_images_journal_id_journal_entries_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_images" ADD CONSTRAINT "journal_images_leg_id_journal_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."journal_legs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_legs" ADD CONSTRAINT "journal_legs_journal_id_journal_entries_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_legs" ADD CONSTRAINT "journal_legs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_legs" ADD CONSTRAINT "journal_legs_first_trade_id_trades_id_fk" FOREIGN KEY ("first_trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setups" ADD CONSTRAINT "setups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_anchor_uq" ON "journal_entries" USING btree ("user_id","anchor_trade_id") WHERE anchor_trade_id is not null and archived_at is null;--> statement-breakpoint
CREATE INDEX "journal_entries_user_idx" ON "journal_entries" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "journal_entries_setup_idx" ON "journal_entries" USING btree ("setup_id");--> statement-breakpoint
CREATE INDEX "journal_images_journal_idx" ON "journal_images" USING btree ("journal_id","phase","position");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_legs_first_trade_uq" ON "journal_legs" USING btree ("journal_id","first_trade_id") WHERE first_trade_id is not null;--> statement-breakpoint
CREATE INDEX "journal_legs_journal_idx" ON "journal_legs" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setups_active_name_uq" ON "setups" USING btree ("user_id","name") WHERE archived_at is null;--> statement-breakpoint
ALTER TABLE "exit_rules" ADD CONSTRAINT "exit_rules_journal_id_journal_entries_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exit_rules_journal_uq" ON "exit_rules" USING btree ("journal_id");