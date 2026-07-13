import { startWhatsAppWorker } from "./queues/whatsapp.queue.js";
import { prisma } from "./lib/prisma.js";
const worker = startWhatsAppWorker();
worker.on("completed", (job) => console.log(`WhatsApp webhook job ${job.id} completed`));
worker.on("failed", (job, error) => console.error(`WhatsApp webhook job ${job?.id ?? "unknown"} failed: ${error.message}`));
const shutdown = async () => { await worker.close(); await prisma.$disconnect(); process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);

