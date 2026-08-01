CREATE TYPE "public"."account_type" AS ENUM('SPECIFIC', 'NISA_OLD', 'NISA_GROWTH', 'NISA_TSUMITATE');--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('JP_EQUITY', 'US_EQUITY', 'FUND');--> statement-breakpoint
CREATE TYPE "public"."cash_kind" AS ENUM('DEPOSIT', 'WITHDRAWAL', 'TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('JPY', 'USD');--> statement-breakpoint
CREATE TYPE "public"."dividend_kind" AS ENUM('DIVIDEND', 'DISTRIBUTION');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('IMPORT', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."price_source" AS ENUM('FINNHUB', 'SCRAPE', 'MANUAL', 'STALE');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('BUY', 'SELL', 'REINVEST', 'REDEEM');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"kind" "cash_kind" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"currency" "currency" NOT NULL,
	"source_row_hash" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dividends" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text,
	"pay_date" date NOT NULL,
	"account_type" "account_type" NOT NULL,
	"kind" "dividend_kind" NOT NULL,
	"gross_amount" numeric(24, 8) NOT NULL,
	"income_tax" numeric(24, 8) DEFAULT '0' NOT NULL,
	"local_tax" numeric(24, 8) DEFAULT '0' NOT NULL,
	"net_amount" numeric(24, 8) NOT NULL,
	"currency" "currency" DEFAULT 'JPY' NOT NULL,
	"is_taxable" boolean NOT NULL,
	"attribution_confident" boolean DEFAULT true NOT NULL,
	"source_row_hash" varchar(64) NOT NULL,
	"source_file" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"base" "currency" NOT NULL,
	"quote" "currency" NOT NULL,
	"rate" numeric(24, 8) NOT NULL,
	"as_of" timestamp NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_base_quote_pk" PRIMARY KEY("base","quote")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_type" varchar(16) NOT NULL,
	"rows_parsed" integer DEFAULT 0 NOT NULL,
	"rows_inserted" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"currency" "currency" NOT NULL,
	"exchange" varchar(32),
	"isin" varchar(12),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"mood" smallint,
	"motivation" smallint,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text,
	"as_of" date NOT NULL,
	"symbol" varchar(128) NOT NULL,
	"account_type" "account_type" NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"valuation_jpy" numeric(24, 8) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_cache" (
	"instrument_id" text PRIMARY KEY NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"currency" "currency" NOT NULL,
	"as_of" timestamp NOT NULL,
	"source" "price_source" NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"manual_override" numeric(24, 8),
	"manual_override_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"trade_date" date NOT NULL,
	"settle_date" date NOT NULL,
	"account_type" "account_type" NOT NULL,
	"side" "trade_side" NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"unit_price" numeric(24, 8) NOT NULL,
	"currency" "currency" NOT NULL,
	"fee" numeric(24, 8) DEFAULT '0' NOT NULL,
	"fee_tax" numeric(24, 8) DEFAULT '0' NOT NULL,
	"other_cost" numeric(24, 8) DEFAULT '0' NOT NULL,
	"fx_rate" numeric(24, 8) DEFAULT '1' NOT NULL,
	"gross_amount" numeric(24, 8) NOT NULL,
	"net_amount" numeric(24, 8) NOT NULL,
	"net_amount_jpy" numeric(24, 8) NOT NULL,
	"points_used" numeric(24, 8),
	"is_settled" boolean DEFAULT true NOT NULL,
	"source_row_hash" varchar(64) NOT NULL,
	"source_file" text NOT NULL,
	"import_batch_id" text,
	"origin" "origin" DEFAULT 'IMPORT' NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_cache" ADD CONSTRAINT "price_cache_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_user_hash_uq" ON "cash_movements" USING btree ("user_id","source_row_hash");--> statement-breakpoint
CREATE INDEX "cash_user_date_idx" ON "cash_movements" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "dividends_user_hash_uq" ON "dividends" USING btree ("user_id","source_row_hash");--> statement-breakpoint
CREATE INDEX "dividends_user_pay_date_idx" ON "dividends" USING btree ("user_id","pay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_symbol_uq" ON "instruments" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_date_uq" ON "notes" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "notes_user_date_idx" ON "notes" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_uq" ON "position_snapshots" USING btree ("user_id","as_of","symbol","account_type");--> statement-breakpoint
CREATE INDEX "snapshot_user_asof_idx" ON "position_snapshots" USING btree ("user_id","as_of");--> statement-breakpoint
CREATE INDEX "price_cache_fetched_idx" ON "price_cache" USING btree ("fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_user_hash_uq" ON "trades" USING btree ("user_id","source_row_hash");--> statement-breakpoint
CREATE INDEX "trades_user_trade_date_idx" ON "trades" USING btree ("user_id","trade_date");--> statement-breakpoint
CREATE INDEX "trades_user_settle_date_idx" ON "trades" USING btree ("user_id","settle_date");--> statement-breakpoint
CREATE INDEX "trades_pool_idx" ON "trades" USING btree ("user_id","instrument_id","account_type","trade_date");--> statement-breakpoint
CREATE INDEX "trades_active_idx" ON "trades" USING btree ("user_id","deleted_at");