# Keeping server code out of the browser

The client bundle once shipped `pg`, all of `drizzle-orm`, the full database
schema, and `iconv-lite`'s Shift-JIS encoding tables — 457 KB of server code,
about 58% of the main chunk. The `iconv-lite` half also *crashed every page*:
it reads `Buffer.prototype` while loading, `Buffer` does not exist in a browser,
and the resulting `TypeError` fired before the app mounted.

```
Module "buffer" has been externalized for browser compatibility.
Uncaught TypeError: Cannot read properties of undefined (reading 'prototype')
    at iconv-lite.js:27
```

Nothing was misconfigured, and no rule in `CLAUDE.md` had been broken. The leak
is a natural consequence of how the two halves of the toolchain interact, which
is why it is worth writing down.

## Why it happens

TanStack Start compiles every module that exports a server function twice. The
client gets a *stub*: the `.handler()` bodies are removed and replaced by an RPC
call, and the imports those bodies were the only user of are then dropped.

Two things survive that transform.

**An exported non-server-function helper.** The compiler cannot know that no
other module imports it, so it must keep it — and with it, everything it
references. `server/screens.ts` exported one helper, `engineFor`, which called
`listTrades` from `~/db/trades.service`. That single export was enough to hold
`~/db` in the client graph.

**Anything reached from a `.validator()`.** Validators are *meant* to run on the
client, so the client keeps them. `server/trades.ts` validates with
`validateManualTrade` from `lib/trades/manual.ts`, which imported `toYen` from
`lib/import/util.ts` — which imported `iconv-lite`. A one-line helper pulled in
300 KB and broke the app.

Then Rollup finishes the job, because of a rule that is easy to forget:

> **A module's top-level side effects are preserved whether or not anything it
> exports is used.**

So `import { db } from '~/db'` is not merely a dead binding once the handler
that used it is gone. `db/index.ts` calls `new Pool(...)` at module scope and
`db/schema.ts` calls `pgTable(...)`, and neither is provably pure — so Rollup
keeps both module bodies, and with them `pg`, `drizzle-orm` and the schema.
`iconv-lite` is worse still: it is CommonJS, so *all* of it is a side effect.

The two mechanisms compound. The framework removes the *references*; Rollup
keeps the *modules* anyway.

## The rules

1. **A module that exports a server function must not export anything else that
   touches the database.** Put the shared helper in a module that only handler
   bodies import — that is what `src/server/engine.ts` is for, and its header
   comment says so.
2. **Nothing reachable from a `.validator()` may import a server-only module.**
   Validators run in the browser by design.
3. **Keep heavy or platform-bound dependencies in a module of their own.**
   `src/lib/import/decode.ts` exists solely so that the one `iconv-lite` import
   cannot be reached by anything that just wanted a string helper from
   `lib/import/util.ts`.
4. **Where an import genuinely must stay inside a server-only body, import it
   there.** `lib/session.ts` and `server/middleware.ts` both do
   `await import('~/lib/auth')` inside the handler, because at module scope it
   reaches `~/db`. Note that hoisting it to a module-scope `() => import(...)`
   does *not* work: the client build then emits the subtree as a lazy chunk
   instead of dropping it.

`src/lib/` staying pure and DB-free — the existing rule in `CLAUDE.md` — is what
makes rules 2 and 3 tractable. `iconv-lite` in `lib/import/util.ts` was the one
violation, and it was the one that crashed.

## The guard

`noServerCodeInClient()` in `vite.config.ts` fails the client build if a
server-only module lands in a browser chunk, listing first-party paths first
because one of them is the root and the rest are the subtree it dragged in. It
is scoped with `applyToEnvironment` so the server build — which of course
contains all of this — is unaffected.

It exists because the failure is quiet. Only `iconv-lite` announced itself; `pg`
and `drizzle-orm` rode along for some time in silence, and would have again.

To check by hand, build with sourcemaps and read what is actually in a chunk:

```bash
npm run build   # with build.sourcemap temporarily enabled
node -e 'const m=require("fs").readFileSync(".output/public/assets/index-XXX.js.map","utf8");
         console.log(JSON.parse(m).sources.join("\n"))'
```

The `sources` array is the authoritative module list for a chunk — more reliable
than grepping minified output, where a match may be nothing but a chunk name.
