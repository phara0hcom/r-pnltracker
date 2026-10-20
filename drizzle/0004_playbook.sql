CREATE TYPE "public"."candle_source" AS ENUM('TRADINGVIEW', 'YAHOO');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('REAL', 'PAPER');--> statement-breakpoint
CREATE TYPE "public"."review_leg_kind" AS ENUM('ENTRY', 'EXIT');--> statement-breakpoint
CREATE TABLE "candle_bars" (
	"ticker" varchar(64) NOT NULL,
	"interval" varchar(8) NOT NULL,
	"bar_time" timestamp with time zone NOT NULL,
	"exchange" varchar(32),
	"open" numeric(24, 8) NOT NULL,
	"high" numeric(24, 8) NOT NULL,
	"low" numeric(24, 8) NOT NULL,
	"close" numeric(24, 8) NOT NULL,
	"volume" numeric(24, 8),
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candle_bars_ticker_interval_bar_time_pk" PRIMARY KEY("ticker","interval","bar_time")
);
--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_charts" (
	"id" text PRIMARY KEY NOT NULL,
	"leg_id" text NOT NULL,
	"user_id" text NOT NULL,
	"interval" varchar(8) NOT NULL,
	"source" "candle_source" NOT NULL,
	"bars" jsonb NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "review_leg_kind" NOT NULL,
	"trade_id" text,
	"date" date NOT NULL,
	"time" varchar(5),
	"price" numeric(24, 8) NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"fee" numeric(24, 8) DEFAULT '0' NOT NULL,
	"rating" smallint,
	"explanation" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"playbook_id" text,
	"kind" "review_kind" NOT NULL,
	"symbol" varchar(128) NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"currency" "currency" NOT NULL,
	"account_type" "account_type",
	"stop_price" numeric(24, 8),
	"target_price" numeric(24, 8),
	"account_equity" numeric(24, 8),
	"risk_rating_override" smallint,
	"criteria_met" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mistakes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lessons" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_charts" ADD CONSTRAINT "review_charts_leg_id_review_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."review_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_charts" ADD CONSTRAINT "review_charts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_legs" ADD CONSTRAINT "review_legs_review_id_trade_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."trade_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_legs" ADD CONSTRAINT "review_legs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_legs" ADD CONSTRAINT "review_legs_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playbooks_user_name_uq" ON "playbooks" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "review_charts_leg_interval_uq" ON "review_charts" USING btree ("leg_id","interval");--> statement-breakpoint
CREATE INDEX "review_legs_review_idx" ON "review_legs" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_legs_trade_uq" ON "review_legs" USING btree ("user_id","trade_id") WHERE trade_id is not null;--> statement-breakpoint
CREATE INDEX "trade_reviews_user_idx" ON "trade_reviews" USING btree ("user_id","playbook_id");