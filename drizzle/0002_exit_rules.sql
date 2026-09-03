CREATE TYPE "public"."trailing_method" AS ENUM('ATR', 'SMA10', 'SMA20');--> statement-breakpoint
CREATE TABLE "exit_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"entry_date" date NOT NULL,
	"entry_price" numeric(24, 8) NOT NULL,
	"total_shares" numeric(24, 8) NOT NULL,
	"support_level" numeric(24, 8) NOT NULL,
	"entry_atr" numeric(24, 8),
	"lot_size" integer DEFAULT 100 NOT NULL,
	"trailing_method" "trailing_method",
	"note" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exit_feed_bars" (
	"instrument_id" text NOT NULL,
	"trading_day" date NOT NULL,
	"bar_time" timestamp NOT NULL,
	"exchange" varchar(32),
	"close" numeric(24, 8) NOT NULL,
	"sma10" numeric(24, 8) NOT NULL,
	"sma20" numeric(24, 8) NOT NULL,
	"rsi14" numeric(24, 8) NOT NULL,
	"macd" numeric(24, 8) NOT NULL,
	"macd_signal" numeric(24, 8) NOT NULL,
	"macd_hist" numeric(24, 8) NOT NULL,
	"atr14" numeric(24, 8) NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exit_feed_bars_instrument_id_trading_day_pk" PRIMARY KEY("instrument_id","trading_day")
);
--> statement-breakpoint
CREATE TABLE "exit_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"target_multiple" numeric(24, 8) DEFAULT '1.5' NOT NULL,
	"partial_exit_fraction" numeric(24, 8) DEFAULT '0.5' NOT NULL,
	"initial_stop_atr_multiple" numeric(24, 8) DEFAULT '1.5' NOT NULL,
	"trailing_atr_multiple" numeric(24, 8) DEFAULT '3' NOT NULL,
	"time_stop_days" integer DEFAULT 12 NOT NULL,
	"trailing_method" "trailing_method" DEFAULT 'ATR' NOT NULL,
	"stale_trading_days" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exit_rules" ADD CONSTRAINT "exit_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_rules" ADD CONSTRAINT "exit_rules_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_feed_bars" ADD CONSTRAINT "exit_feed_bars_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_settings" ADD CONSTRAINT "exit_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Partial, so re-entering the same name after an exit is a new plan rather than
-- a constraint violation against the archived one.
CREATE UNIQUE INDEX "exit_rules_active_uq" ON "exit_rules" USING btree ("user_id","instrument_id","account_type") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "exit_rules_user_idx" ON "exit_rules" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "exit_feed_day_idx" ON "exit_feed_bars" USING btree ("trading_day");
