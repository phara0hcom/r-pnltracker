CREATE TYPE "public"."feed_delivery_outcome" AS ENUM('STORED', 'UNKNOWN_TICKER', 'INVALID_PAYLOAD');--> statement-breakpoint
CREATE TABLE "exit_feed_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp NOT NULL,
	"duration_ms" integer NOT NULL,
	"outcome" "feed_delivery_outcome" NOT NULL,
	"status" smallint NOT NULL,
	"ticker" varchar(128),
	"exchange" varchar(32),
	"instrument_id" text,
	"trading_day" date,
	"backfilled" integer,
	"priced" boolean,
	"detail" text
);
--> statement-breakpoint
ALTER TABLE "exit_feed_deliveries" ADD CONSTRAINT "exit_feed_deliveries_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exit_feed_deliveries_received_idx" ON "exit_feed_deliveries" USING btree ("received_at");