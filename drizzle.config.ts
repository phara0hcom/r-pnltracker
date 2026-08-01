import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // drizzle-kit runs standalone; a missing URL should fail loudly here.
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
})
