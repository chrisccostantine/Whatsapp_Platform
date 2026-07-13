import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { initializeSocket } from "./realtime/socket.js";

const server = createServer(app);
initializeSocket(server);
server.listen(env.PORT, "0.0.0.0", () => console.log(`Scalora API listening on ${env.PORT}`));
const shutdown = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
