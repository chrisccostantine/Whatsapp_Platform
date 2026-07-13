import IORedis from "ioredis";
import { env } from "../config/env.js";
let connection: IORedis | undefined;
export function getQueueConnection() {
  if (!env.REDIS_URL) return undefined;
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  return connection;
}

