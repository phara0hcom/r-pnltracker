CREATE TYPE "public"."exit_action_kind" AS ENUM('HOLD', 'TAKE_PARTIAL', 'MOVE_TO_BREAKEVEN', 'TRAIL_ACTIVE', 'STOPPED_OUT', 'STOPPED_OUT_GAP', 'TIME_STOP', 'DATA_STALE', 'AWAITING_FEED', 'POSITION_CLOSED', 'PLAN_SUPERSEDED');--> statement-breakpoint
CREATE TABLE "exit_action_state" (
	"exit_rule_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"last_action_kind" "exit_action_kind" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exit_action_state" ADD CONSTRAINT "exit_action_state_exit_rule_id_exit_rules_id_fk" FOREIGN KEY ("exit_rule_id") REFERENCES "public"."exit_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_action_state" ADD CONSTRAINT "exit_action_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");