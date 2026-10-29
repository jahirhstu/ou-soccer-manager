import { createSupabaseServerClient } from "./supabase/server";

export async function requireEnabledProgramModule(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  programId: string | null | undefined,
  moduleKey: string
) {
  if (!programId) throw new Error("Program context is required.");
  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id,status")
    .eq("id", programId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (programError) throw new Error(programError.message);
  if (!program || program.status !== "active") throw new Error("Program is unavailable.");
  const { data: module, error: moduleError } = await supabase
    .from("program_modules")
    .select("enabled")
    .eq("program_id", programId)
    .eq("module_key", moduleKey)
    .maybeSingle();
  if (moduleError) throw new Error(moduleError.message);
  if (module && !module.enabled) throw new Error(`${moduleKey.replaceAll("_", " ")} is disabled for this program.`);
}
