import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { initializeSocket } from "./realtime/socket.js";

const server = createServer(app);
initializeSocket(server);
server.listen(env.PORT, "0.0.0.0", () => console.log(`Scalora API listening on ${env.PORT}`));
let shuttingDown = false;
const shutdown = async () => { if (shuttingDown) return; shuttingDown = true; const force = setTimeout(() => process.exit(1), 10_000); force.unref(); await new Promise<void>((resolve) => server.close(() => resolve())); await prisma.$disconnect(); clearTimeout(force); process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
process.on("uncaughtException", (error) => { console.error("Uncaught exception", error); void shutdown(); });
process.on("unhandledRejection", (error) => { console.error("Unhandled rejection", error); void shutdown(); });
