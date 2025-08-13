import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../drizzle/schema.ts';

const connectionString = process.env.DATABASE_URL || 'postgresql://event_api_user:development_password@localhost:5432/event_api_dev';

// Connection pool configuration
const poolConfig = {
  max: 20,                    // Maximum number of connections
  idle_timeout: 30,          // Close connections idle for 30 seconds
  connect_timeout: 60,       // 60 second connect timeout
  prepare: false,            // Disable prepared statements for better pooling
  onnotice: process.env.NODE_ENV === 'development' ? console.log : undefined
};

// Create connection pool
const sql = postgres(connectionString, poolConfig);

// Create drizzle instance with schema
export const db = drizzle(sql, { schema });

// Export connection for raw queries if needed
export { sql };

// Health check function
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

// Graceful shutdown
export async function closeDatabaseConnection(): Promise<void> {
  await sql.end();
}