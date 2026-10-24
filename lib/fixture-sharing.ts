import { canShareImages, imageFileName, shareImages } from "@/lib/image-sharing";

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
  return imageFileName(label, "fixture", date);
}

export function canShareImage(file: File) {
  return canShareImages([file]);
}

export async function shareImage(file: File, title: string): Promise<"shared" | "cancelled"> {
  return shareImages([file], title);
}
