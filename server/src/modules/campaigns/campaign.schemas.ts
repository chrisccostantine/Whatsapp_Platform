import { z } from "zod";

const lifecycleStage = z.enum(["NEW_LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST", "EXISTING_CUSTOMER"]);
const customerSource = z.enum(["WHATSAPP", "INSTAGRAM", "FACEBOOK", "WEBSITE", "PHONE", "WALK_IN", "REFERRAL", "OTHER"]);

export const audienceSchema = z.object({
  selectedTagIds: z.array(z.string().uuid()).max(20).default([]),
  excludedTagIds: z.array(z.string().uuid()).max(20).default([]),
  lifecycleStages: z.array(lifecycleStage).max(8).default([]),
  sources: z.array(customerSource).max(8).default([]),
  assignedUserId: z.string().uuid().nullable().default(null)
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(3).max(120),
  templateId: z.string().uuid(),
  audience: audienceSchema,
  bodyVariables: z.array(z.string().trim().max(1024)).max(20).default([]),
  scheduledAt: z.coerce.date().nullable().optional()
});

export type CampaignAudience = z.infer<typeof audienceSchema>;
