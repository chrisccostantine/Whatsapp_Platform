import { Redis } from "ioredis";
import { env } from "../config/env.js";
let connection: Redis | undefined;
export function getQueueConnection() {
  if (!env.REDIS_URL) return undefined;
  connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  return connection;
}
