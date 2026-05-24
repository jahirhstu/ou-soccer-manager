export type UserRole = "admin" | "captain" | "player";
export type SeasonStatus = "draft" | "active" | "archived";
export type SessionStatus = "scheduled" | "completed" | "cancelled";
export type AttendanceStatus = "confirmed" | "played" | "absent" | "dropped" | "replacement" | "waitlisted";
export type TransferType =
  | "credit_to_original_player"
  | "replacement_owes_original_player"
  | "replacement_paid_admin"
  | "no_credit"
  | "manual_adjustment";
export type LedgerType =
  | "payment_received"
  | "session_used"
  | "credit_added"
  | "credit_transferred_out"
  | "credit_transferred_in"
  | "refund_due"
  | "refund_paid"
  | "manual_adjustment";
export type Confidence = "low" | "medium" | "high";

export type Profile = {
  id: string;
  display_name: string;
  email: string | null;
  role: UserRole;
  player_id: string | null;
};

export type Player = {
  id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive";
  preferred_position: string | null;
  notes: string | null;
};

export type PlayerAlias = {
  id: string;
  player_id: string;
  alias_name: string;
  normalized_alias: string;
  match_count: number;
};

export type Playground = {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
};

export type Season = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  total_planned_sessions: number | null;
  price_per_session: number;
  status: SeasonStatus;
  notes: string | null;
};

export type Session = {
  id: string;
  season_id: string;
  playground_id: string | null;
  name: string | null;
  session_date: string;
  location: string | null;
  start_time: string | null;
  end_time: string | null;
  price_per_session: number | null;
  status: SessionStatus;
  notes: string | null;
};

export type ParsedWhatsAppImport = {
  rawText: string;
  importType: "season_signup" | "session_update";
  confidence: Confidence;
  season?: {
    name?: string;
    startDate?: string;
    endDate?: string;
    totalSessions?: number;
    pricePerSession?: number;
  };
  session?: {
    name?: string;
    date?: string;
    location?: string;
    startTime?: string;
    endTime?: string;
    duration?: string;
    totalSessions?: number;
    pricePerSession?: number;
    fullSeasonCost?: number;
  };
  players: Array<{ name: string; matchedPlayerId?: string; confidence: Confidence }>;
  payments: Array<{
    playerName: string;
    matchedPlayerId?: string;
    amount?: number;
    sessionsCovered?: number;
    paymentMethod?: string;
    note?: string;
    balanceOwed?: number;
    amountSource?: "player_line" | "inferred_session_price" | "general_context";
    confidence: Confidence;
  }>;
  attendance: Array<{
    playerName: string;
    matchedPlayerId?: string;
    status: AttendanceStatus;
    confidence: Confidence;
  }>;
  dropouts: Array<{
    originalPlayerName: string;
    replacementPlayerName?: string;
    transferType?: TransferType | string;
    note?: string;
    confidence: Confidence;
  }>;
  teams: Array<{
    name?: string;
    teamName?: string;
    team_name?: string;
    label?: string;
    captainName?: string;
    players: string[];
    confidence: Confidence;
  }>;
  matches: Array<{
    matchNumber: number;
    teamAName: string;
    teamBName: string;
    teamAScore: number;
    teamBScore: number;
    confidence: Confidence;
  }>;
  goals: Array<{
    scorerName: string;
    assistName?: string;
    count?: number;
    team?: "A" | "B";
    teamName?: string;
    note?: string;
    confidence: Confidence;
  }>;
  warnings: string[];
};

export type PlayerBalance = {
  totalPaidSessions: number;
  totalPaidAmount: number;
  totalPlayedSessions: number;
  remainingPaidSessions: number;
  sessionsOwed: number;
  creditBalance: number;
  refundAmount: number;
  owesAmount: number;
};
