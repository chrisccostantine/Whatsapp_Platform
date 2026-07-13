import type { MembershipRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; businessId: string; membershipId: string; role: MembershipRole };
      rawBody?: Buffer;
    }
  }
}
export {};
