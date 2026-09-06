CREATE TABLE "price_overrides" (
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"currency" "currency" NOT NULL,
	"set_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "price_overrides_user_id_instrument_id_pk" PRIMARY KEY("user_id","instrument_id")
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "motivation" smallint;--> statement-breakpoint
ALTER TABLE "price_overrides" ADD CONSTRAINT "price_overrides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_overrides" ADD CONSTRAINT "price_overrides_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Carry existing overrides across before the columns holding them are dropped.
-- The old table had no owner column, so each override is granted to every user:
-- for a single-user install that is exact, and it is the only reading of
-- "previously global" that loses nothing.
INSERT INTO "price_overrides" ("user_id", "instrument_id", "price", "currency", "set_at")
SELECT u."id", pc."instrument_id", pc."manual_override", pc."currency", COALESCE(pc."manual_override_at", now())
FROM "price_cache" pc CROSS JOIN "user" u
WHERE pc."manual_override" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "price_cache" DROP COLUMN "manual_override";--> statement-breakpoint
ALTER TABLE "price_cache" DROP COLUMN "manual_override_at";