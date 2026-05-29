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
  playground_id: z.preprocess((value) => (value === "" || value == null ? undefined : value), z.string().uuid().optional()),
  name: z.string().optional().nullable(),
  session_date: z.string().min(8),
  location: z.string().optional().nullable(),
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
  price_per_session: optionalNumber,
  status: z.enum(["scheduled", "completed", "cancelled"]).default("scheduled"),
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
  payment_method: z.preprocess(
    (value) => (value === "" || value == null ? "e-transfer" : value),
    z.string()
  ),
  reference_note: z.string().optional().nullable()
});

export const attendanceSchema = z.object({
  session_id: z.string().uuid(),
  player_id: z.string().uuid(),
  status: z.enum(["confirmed", "played", "absent", "dropped", "replacement", "waitlisted"]),
  notes: z.string().optional().nullable()
});

export const leagueSchema = z.object({
  season_id: z.preprocess((value) => (value === "" || value == null ? undefined : value), z.string().uuid().optional()),
  name: z.string().min(2),
  status: z.enum(["draft", "active", "completed", "archived"]).default("draft"),
  points_for_win: z.coerce.number().int().nonnegative().default(3),
  points_for_draw: z.coerce.number().int().nonnegative().default(1),
  points_for_loss: z.coerce.number().int().nonnegative().default(0),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const leagueTeamSchema = z.object({
  league_id: z.string().uuid(),
  name: z.string().min(1),
  captain_player_id: z.preprocess((value) => (value === "" || value == null ? undefined : value), z.string().uuid().optional()),
  seed_order: z.preprocess((value) => (value === "" || value == null ? undefined : value), z.coerce.number().int().nonnegative().optional()),
  player_ids: z.array(z.string().uuid()).default([])
});

export const whatsappInputSchema = z.object({
  rawText: z.string().min(2),
  seasonId: z.union([z.string().uuid(), z.literal("__create__")]).optional(),
  sessionId: z.union([z.string().uuid(), z.literal("__create__")]).optional()
});
