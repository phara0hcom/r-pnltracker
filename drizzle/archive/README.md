# Superseded migrations

These five files built the schema up to September 2026. They are kept for the
reasoning in their comments — why the entry multiples were frozen onto the plan,
why `price_source` gained `FEED` — not because anything replays them.

**None of them was ever applied by drizzle-kit.** There is no
`__drizzle_migrations` table in the database; the schema has always been pushed
with `npm run db:push`, which diffs `src/db/schema.ts` against the live database
and ignores this folder entirely. Two of the five were hand-written, which is why
`drizzle/meta` fell out of step with them and why `db:generate` eventually
emitted a migration proposing to create tables that already existed.

`drizzle/0000_baseline.sql` replaces all five as the starting point. Everything
here is already in the database.
