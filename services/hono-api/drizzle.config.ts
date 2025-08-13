import type { Config } from 'drizzle-kit';

export default {
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://event_api_user:development_password@localhost:5432/event_api_dev'
  },
  verbose: true,
  strict: true
} satisfies Config;