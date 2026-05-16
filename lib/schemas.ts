import { z } from "zod";

const optionalNumber = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.number().nonnegative().optional()
);

export const seasonSchema = z.object({
  name: z.string().min(2),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  total_planned_sessions: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().int().nonnegative().optional()
  ),
  price_per_session: z.coerce.number().nonnegative(),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  notes: z.string().optional().nullable()
});

export const sessionSchema = z.object({
  season_id: z.string().uuid(),
  name: z.string().optional().nullable(),
  session_date: z.string().min(8),
  location: z.string().optional().nullable(),
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
  price_per_session: optionalNumber,
  status: z.enum(["scheduled", "completed", "cancelled"]).default("scheduled"),
  team_a_score: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().int().nonnegative().optional()
  ),
  team_b_score: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().int().nonnegative().optional()
  ),
  notes: z.string().optional().nullable()
});

export const playerSchema = z.object({
  display_name: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
  preferred_position: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const paymentSchema = z.object({
  season_id: z.string().uuid(),
  player_id: z.string().uuid(),
  payment_date: z.string().min(8),
  amount: z.coerce.number().positive(),
  sessions_covered: optionalNumber,
  payment_method: z.string().optional().nullable(),
  reference_note: z.string().optional().nullable()
});

export const attendanceSchema = z.object({
  session_id: z.string().uuid(),
  player_id: z.string().uuid(),
  status: z.enum(["confirmed", "played", "absent", "dropped", "replacement", "waitlisted"]),
  notes: z.string().optional().nullable()
});

export const whatsappInputSchema = z.object({
  rawText: z.string().min(2),
  seasonId: z.union([z.string().uuid(), z.literal("__create__")]).optional(),
  sessionId: z.union([z.string().uuid(), z.literal("__create__")]).optional()
});
