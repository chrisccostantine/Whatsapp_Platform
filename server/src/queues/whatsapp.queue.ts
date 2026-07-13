import { Queue, Worker } from "bullmq";
import { env } from "../config/env.js";
import { getQueueConnection } from "./connection.js";
const queueName = "whatsapp-webhooks";
let queue: Queue | undefined;

export async function enqueueWhatsAppWebhook(eventId: string) {
  const connection = getQueueConnection();
  if (!connection) {
    if (env.NODE_ENV === "production") throw new Error("REDIS_URL is required for production webhooks");
    setImmediate(() => void import("../modules/whatsapp/webhook.processor.js").then(({ processWebhookEvent }) => processWebhookEvent(eventId)).catch(console.error));
    return;
  }
  queue ??= new Queue(queueName, { connection });
  await queue.add("process-webhook", { eventId }, { jobId: eventId, attempts: 6, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: 500, removeOnFail: 2_000 });
}

export function startWhatsAppWorker() {
  const connection = getQueueConnection();
  if (!connection) throw new Error("REDIS_URL is required to run the WhatsApp worker");
  return new Worker<{ eventId: string }>(queueName, async (job) => { const { processWebhookEvent } = await import("../modules/whatsapp/webhook.processor.js"); await processWebhookEvent(job.data.eventId); }, { connection, concurrency: 10 });
}

