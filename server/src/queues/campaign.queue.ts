import { Queue, Worker } from "bullmq";
import { env } from "../config/env.js";
import { getQueueConnection } from "./connection.js";

const queueName = "whatsapp-campaigns";
type CampaignJob = { recipientId: string };
let queue: Queue<CampaignJob> | undefined;

export async function enqueueCampaignRecipients(recipientIds: string[], scheduledAt: Date | null, uniqueRun = "initial") {
  const connection = getQueueConnection();
  const delay = Math.max(0, (scheduledAt?.getTime() ?? Date.now()) - Date.now());
  if (!connection) {
    if (env.NODE_ENV === "production") throw new Error("REDIS_URL is required for campaign delivery");
    for (const recipientId of recipientIds) setImmediate(() => void import("../modules/campaigns/campaign.processor.js").then(({ processCampaignRecipient }) => processCampaignRecipient(recipientId)).catch(console.error));
    return;
  }
  queue ??= new Queue<CampaignJob>(queueName, { connection });
  await queue.addBulk(recipientIds.map((recipientId) => ({ name: "deliver-template", data: { recipientId }, opts: { jobId: `${recipientId}-${uniqueRun}`, delay, attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 2_000, removeOnFail: 5_000 } })));
}

export function startCampaignWorker() {
  const connection = getQueueConnection();
  if (!connection) throw new Error("REDIS_URL is required to run the campaign worker");
  return new Worker<CampaignJob>(queueName, async (job) => {
    const { processCampaignRecipient } = await import("../modules/campaigns/campaign.processor.js");
    await processCampaignRecipient(job.data.recipientId);
  }, { connection, concurrency: 5, limiter: { max: 20, duration: 1_000 } });
}
