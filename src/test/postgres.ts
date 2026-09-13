/**
 * A throwaway Postgres for the `*.db.test.ts` suites.
 *
 * Every one of them needs the same three things before it can ask the server
 * anything: a container, the schema built from `drizzle/`, and an owner to hang
 * user-scoped rows on. Two copies of that had already drifted apart in their
 * comments, and the Podman and teardown notes below are the kind that get
 * learned once and need somewhere single to live.
 *
 * Usage is `beforeAll(startPostgres)` / `afterAll(stopPostgres)`, gating the
 * suites with `describe.skipIf(!containerAvailable)`. `startPostgres` resolves
 * to the raw `pg` pool for assertions that want SQL rather than a service.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

/**
 * Finds a container runtime and points testcontainers at it.
 *
 * A socket check rather than a trial container: this decides whether a suite
 * reports "skipped" or spends two minutes timing out, so it has to be quick and
 * certain. Covers Docker and Podman, including the machine socket Podman
 * Desktop creates — testcontainers looks for Docker's paths only, so a Podman
 * socket has to be handed to it through `DOCKER_HOST` or it finds nothing.
 *
 * Returns whether the suites can run at all.
 */
function findContainerRuntime(): boolean {
  const home = process.env.HOME ?? ''

  // An explicit DOCKER_HOST is the developer's decision; never second-guess it.
  const host =
    process.env.DOCKER_HOST ??
    [
      `${home}/.local/share/containers/podman/machine/podman.sock`,
      `${home}/.docker/run/docker.sock`,
      '/var/run/docker.sock',
    ]
      .filter((path) => existsSync(path))
      .map((path) => `unix://${path}`)[0]

  if (host === undefined) return false
  process.env.DOCKER_HOST = host

  /*
   * Ryuk is testcontainers' reaper: a sidecar that bind-mounts the container
   * socket and removes anything left behind if the run is killed. On macOS a
   * Podman machine socket cannot be bind-mounted at all — the daemon answers
   * `statfs … operation not supported` — so with Podman the reaper is not
   * optional to skip, it simply cannot start.
   *
   * The cost is the safety net, not correctness: `afterAll` stops the container
   * on any normal finish, including a failing test. Only a hard kill mid-run
   * can strand one, and `podman ps` / `podman rm` clears it.
   */
  if (host.includes('podman')) process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true'

  return true
}

/** The schema, in the order `drizzle/meta/_journal.json` says it was built. */
function migrationFiles(): string[] {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string }[]
  }
  return journal.entries.map((entry) => join('drizzle', `${entry.tag}.sql`))
}

/** Probed once per worker: whether `test:db` can run here at all. */
export const containerAvailable = findContainerRuntime()

/** The owner every suite's rows belong to — everything user-facing is scoped. */
export const TEST_USER = 'u-test-1'

let container: StartedPostgreSqlContainer | undefined
let sql: Pool | undefined
/** The pool the services share, so teardown can close it before the server goes. */
let servicePool: { end: () => Promise<void> } | undefined

/**
 * Start a database, build the schema into it, and seed the owner.
 *
 * Resolves to `undefined` when no container runtime is present, so a suite can
 * be gated with `skipIf` and this stays a no-op rather than a failure.
 */
export async function startPostgres(): Promise<Pool | undefined> {
  if (!containerAvailable) return undefined

  container = await new PostgreSqlContainer('postgres:17-alpine').start()

  /*
   * Set before any service is imported, not after: `db/index.ts` reads
   * DATABASE_URL at module scope and builds its pool once, so a static import
   * would have already connected to whatever the environment said at load.
   * Importing it here rather than leaving it to the caller makes that ordering
   * structural instead of a comment each suite has to obey.
   */
  process.env.DATABASE_URL = container.getConnectionUri()

  sql = new Pool({ connectionString: container.getConnectionUri() })
  /*
   * The baseline plus every migration after it, in the journal's own order.
   * Reading only the baseline was enough while it was the whole schema, and
   * stopped being enough the moment one table arrived in a later file — the
   * suite then failed on a table the application had and the test database did
   * not, which reads as a code fault rather than a fixture one.
   */
  for (const file of migrationFiles()) {
    await sql.query(readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', ''))
  }
  await sql.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'owner', 'owner@example.com', true, now(), now())`,
    [TEST_USER],
  )

  servicePool = (await import('~/db/index')).db.$client
  return sql
}

/**
 * Stop everything, in the order that keeps the failure report honest.
 *
 * `db/index.ts` opens a pool at module scope and keeps its connections open;
 * stopping the container first severs them mid-flight and `pg` raises
 * "Connection terminated unexpectedly" with no test to attach it to. Vitest
 * reports that as an unhandled error and warns it may be masking a real
 * failure — so the clients are closed before the server they point at.
 */
export async function stopPostgres(): Promise<void> {
  await sql?.end()
  await servicePool?.end()
  await container?.stop()
  sql = undefined
  servicePool = undefined
  container = undefined
}
