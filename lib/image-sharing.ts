export function imageFileName(label: string, kind: string, date?: string | null) {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(label) || "session"}${date ? `-${date.replace(/[^0-9-]/g, "")}` : ""}-${slug(kind) || "report"}.png`;
}

export function canShareImages(files: File[]) {
  if (!files.length) return false;
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files });
  } catch {
    return false;
  }
}

export async function shareImages(files: File[], title: string): Promise<"shared" | "cancelled"> {
  try {
    await navigator.share({ files, title });
    return "shared";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    throw error;
  }
}
