import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import { env } from "./config/env.js";
import { apiRouter } from "./routes.js";
import { prisma } from "./lib/prisma.js";
import { createClient } from "redis";
import { errorHandler, notFound } from "./middleware/error-handler.js";

export const app = express();
app.set("trust proxy", 1);
app.use(pinoHttp({ redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.token"] }));
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api/v1/auth", rateLimit({ windowMs: 15 * 60_000, limit: 100, standardHeaders: "draft-7", legacyHeaders: false }));
app.get("/api/v1/health", (_req, res) => res.json({ success: true, data: { status: "ok", uptime: process.uptime() }, message: "Service is healthy" }));
app.get("/api/v1/health/database", async (_req, res) => { try { await prisma.$queryRaw`SELECT 1`; res.json({ success: true, data: { status: "ok" }, message: "Database is healthy" }); } catch { res.status(503).json({ success: false, error: { code: "DATABASE_UNAVAILABLE", message: "Database is unavailable" } }); } });
app.get("/api/v1/health/redis", async (_req, res) => {
  if (!env.REDIS_URL) { res.status(503).json({ success: false, error: { code: "REDIS_NOT_CONFIGURED", message: "Redis is not configured" } }); return; }
  const client = createClient({ url: env.REDIS_URL });
  try { await client.connect(); await client.ping(); res.json({ success: true, data: { status: "ok" }, message: "Redis is healthy" }); }
  catch { res.status(503).json({ success: false, error: { code: "REDIS_UNAVAILABLE", message: "Redis is unavailable" } }); }
  finally { if (client.isOpen) await client.disconnect(); }
});
app.use("/api/v1", apiRouter);
app.use(notFound);
app.use(errorHandler);
