import type { Response } from "express";

export const ok = <T>(res: Response, data: T, message = "Operation completed successfully", status = 200) =>
  res.status(status).json({ success: true, data, message });

