import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export const notFound: RequestHandler = (_req, _res, next) =>
  next(new AppError(404, "NOT_FOUND", "The requested resource was not found"));

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.flatten() } });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ success: false, error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    res.status(409).json({ success: false, error: { code: "DUPLICATE_RESOURCE", message: "A record with these details already exists" } });
    return;
  }
  if (process.env.NODE_ENV !== "test") console.error(error);
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
};

