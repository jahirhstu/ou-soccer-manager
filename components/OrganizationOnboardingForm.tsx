"use client";

import { useMemo, useState, useTransition } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { onboardOrganizationAction } from "@/lib/actions/platform";

type ModuleOption = {
  module_key: string;
  default_enabled: boolean;
  required: boolean;
  module_catalog: { name: string; description: string | null } | { name: string; description: string | null }[] | null;
};

type TemplateOption = {
  id: string;
  key: string;
  name: string;
  category: string;
  program_template_modules: ModuleOption[];
};

type ProgramDraft = {
  templateId: string;
  name: string;
  slug: string;
  modules: string[];
  isDefault: boolean;
};

export function OrganizationOnboardingForm({ templates }: { templates: TemplateOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [organizationName, setOrganizationName] = useState("");
  const [slug, setSlug] = useState("");
  const [programs, setPrograms] = useState<ProgramDraft[]>([]);
  const [invitationUrl, setInvitationUrl] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const selectedTemplateIds = useMemo(() => new Set(programs.map((program) => program.templateId)), [programs]);

  function toggleTemplate(template: TemplateOption) {
    if (selectedTemplateIds.has(template.id)) {
      setPrograms((current) => current.filter((program) => program.templateId !== template.id).map((program, index) => ({ ...program, isDefault: index === 0 })));
      return;
    }
    const defaultModules = template.program_template_modules.filter((module) => module.default_enabled).map((module) => module.module_key);
    setPrograms((current) => [...current, {
      templateId: template.id,
      name: organizationName ? `${organizationName} ${template.name}` : template.name,
      slug: template.key,
      modules: defaultModules,
      isDefault: current.length === 0
    }]);
  }

  function updateProgram(templateId: string, update: Partial<ProgramDraft>) {
    setPrograms((current) => current.map((program) => program.templateId === templateId ? { ...program, ...update } : program));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("programs_json", JSON.stringify(programs));
    startTransition(async () => {
      try {
        const result = await onboardOrganizationAction(formData);
        const url = `${window.location.origin}${result.invitationPath}`;
        setInvitationUrl(url);
        setOrganizationId(result.organizationId);
        await navigator.clipboard?.writeText(url);
        toast.success("Organization created. The owner invitation link was copied.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not create organization.");
      }
    });
  }

  return (
    <form className="grid gap-6" onSubmit={submit}>
      <section className="panel grid gap-4 p-5">
        <div>
          <h2 className="section-title">1. Organization</h2>
          <p className="mt-1 text-sm text-slate-500">Create the tenant and its regional settings.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Name
            <input className="input" name="name" required minLength={2} value={organizationName} onChange={(event) => {
              const name = event.target.value;
              setOrganizationName(name);
              if (!slug || slug === toSlug(organizationName)) setSlug(toSlug(name));
            }} />
          </label>
          <label className="grid gap-1 text-sm font-medium">Slug
            <input className="input" name="slug" required value={slug} onChange={(event) => setSlug(toSlug(event.target.value))} />
          </label>
          <label className="grid gap-1 text-sm font-medium">Category
            <select className="input" name="organization_category" defaultValue="sports_club">
              <option value="sports_club">Sports club</option>
              <option value="event_group">Event group</option>
              <option value="community_group">Community group</option>
              <option value="social_group">Social group</option>
              <option value="generic">Generic</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Currency
            <input className="input uppercase" name="currency_code" defaultValue="CAD" maxLength={3} required />
          </label>
          <label className="grid gap-1 text-sm font-medium sm:col-span-2">Time zone
            <input className="input" name="timezone" defaultValue="America/Toronto" required />
          </label>
        </div>
      </section>

      <section className="panel grid gap-4 p-5">
        <div>
          <h2 className="section-title">2. Programs and modules</h2>
          <p className="mt-1 text-sm text-slate-500">Select eligible templates, then configure the initial program instance.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {templates.map((template) => (
            <button className={selectedTemplateIds.has(template.id) ? "btn-primary" : "btn-secondary"} key={template.id} onClick={() => toggleTemplate(template)} type="button">
              {template.name}
            </button>
          ))}
        </div>
        <div className="grid gap-4">
          {programs.map((program) => {
            const template = templates.find((item) => item.id === program.templateId)!;
            return (
              <div className="rounded-xl border border-line p-4" key={program.templateId}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{template.name}</h3>
                  <label className="flex items-center gap-2 text-sm">
                    <input checked={program.isDefault} name="default_program" onChange={() => setPrograms((current) => current.map((item) => ({ ...item, isDefault: item.templateId === program.templateId })))} type="radio" />
                    Default program
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">Program name
                    <input className="input" required value={program.name} onChange={(event) => updateProgram(program.templateId, { name: event.target.value })} />
                  </label>
                  <label className="grid gap-1 text-sm">Program slug
                    <input className="input" required value={program.slug} onChange={(event) => updateProgram(program.templateId, { slug: toSlug(event.target.value) })} />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {template.program_template_modules.map((module) => {
                    const catalog = Array.isArray(module.module_catalog) ? module.module_catalog[0] : module.module_catalog;
                    const checked = program.modules.includes(module.module_key);
                    return (
                      <label className={`rounded-lg border px-3 py-2 text-sm ${checked ? "border-emerald-300 bg-emerald-50" : "border-line bg-white"}`} key={module.module_key}>
                        <input
                          checked={checked}
                          className="mr-2"
                          disabled={module.required}
                          onChange={(event) => updateProgram(program.templateId, {
                            modules: event.target.checked
                              ? [...program.modules, module.module_key]
                              : program.modules.filter((key) => key !== module.module_key)
                          })}
                          type="checkbox"
                        />
                        {catalog?.name ?? module.module_key}{module.required ? " · required" : ""}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!programs.length ? <p className="rounded-lg border border-dashed p-5 text-sm text-slate-500">Select at least one program template.</p> : null}
        </div>
      </section>

      <section className="panel grid gap-4 p-5">
        <div>
          <h2 className="section-title">3. First organization owner</h2>
          <p className="mt-1 text-sm text-slate-500">A single-use invitation valid for 72 hours will grant Owner and default-program Manager roles.</p>
        </div>
        <label className="grid gap-1 text-sm font-medium">Owner email
          <input className="input" name="owner_email" type="email" required />
        </label>
      </section>

      <button className="btn-primary w-fit" disabled={isPending || !programs.length}>
        {isPending ? "Creating organization..." : "Create organization and owner invitation"}
      </button>
      {invitationUrl ? (
        <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <p>Copy this invitation now. Only its hash is stored and the link cannot be recovered later.</p>
          <p className="break-all font-mono">{invitationUrl}</p>
          <Link className="font-semibold underline" href={`/platform/organizations/${organizationId}`}>Open organization management</Link>
        </div>
      ) : null}
    </form>
  );
}

function toSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
