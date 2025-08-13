export interface ElixirServiceConfig {
  baseURL: string;
  timeout: number;
  retries: number;
  retryDelay: number;
  healthCheckInterval: number;
}

export const defaultElixirConfig: ElixirServiceConfig = {
  baseURL: process.env.ELIXIR_SERVICE_URL || 'http://localhost:4000',
  timeout: 30000, // 30 seconds
  retries: 3,
  retryDelay: 1000, // 1 second
  healthCheckInterval: 60000, // 1 minute
};