import { revalidatePath } from "next/cache";

export function revalidatePerformanceViews(sessionId?: string) {
  if (sessionId) {
    revalidatePath(`/sessions/${sessionId}/performance`);
    revalidatePath(`/sessions/${sessionId}/scores`);
  }
  revalidatePath("/reports/performance");
  revalidatePath("/public/report");
  revalidatePath("/dashboard");
}
