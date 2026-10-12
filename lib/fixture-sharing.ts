export function fixtureTimeRange(start?: string | null, end?: string | null) {
  if (start && end) return `${formatTime(start)}-${formatTime(end)}`;
  if (start) return `${formatTime(start)} start`;
  if (end) return `${formatTime(end)} end`;
  return "TBD";
}

function formatTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

export function fixtureBreakMinutes(start?: string | null, end?: string | null) {
  const parse = (value?: string | null) => {
    if (!value) return null;
    const [hours, minutes] = value.split(":").map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
  };
  const previousEnd = parse(start);
  const nextStart = parse(end);
  return previousEnd == null || nextStart == null ? 0 : Math.max(0, nextStart - previousEnd);
}

export function fixtureImageName(label: string, date?: string | null) {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
  return `${safeLabel}${date ? `-${date.replace(/[^0-9-]/g, "")}` : ""}-fixture.png`;
}

export function canShareImage(file: File) {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareImage(file: File, title: string): Promise<"shared" | "cancelled"> {
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    throw error;
  }
}
