import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

let connection: ConnectionOptions | undefined;

export function getQueueConnection() {
  if (!env.REDIS_URL) return undefined;
  connection ??= {
    url: env.REDIS_URL,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
  return connection;
}
