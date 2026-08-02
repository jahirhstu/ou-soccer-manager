# Organization onboarding and authorization

## Confirmed hierarchy

1. Platform Owner controls global templates, module definitions, and platform administrators.
2. Platform Superadmin creates organizations and manages only organizations explicitly assigned to them.
3. Organization Owner has full tenant authority and protects the last-owner invariant.
4. Organization Admin manages tenant users, programs, settings, and runtime modules, but cannot grant ownership.
5. Program Manager manages operations and membership for an assigned program, not organization settings or administrators.
6. Captain has module-dependent attendance, team, fixture, score, and statistics operations.
7. Member/Player has personal and permitted read access.

Platform authority is stored in `platform_accounts`; tenant and program authority remain in their membership tables.

## Onboarding transaction

`create_organization_onboarding` accepts organization settings, one or more initial program instances, selected modules, and a hashed first-owner invitation. It verifies a Platform Owner or Platform Superadmin and atomically creates:

- the organization and settings;
- platform access for a creating Superadmin;
- organization template entitlements;
- initial programs and module flags;
- the default program;
- a 72-hour, single-use Owner/Manager invitation;
- an onboarding audit record.

The plaintext invitation token is generated server-side and returned once. Only its SHA-256 hash is stored.

## Template/module behavior

- `module_catalog` defines valid global modules.
- `program_template_modules` defines available, default, and required template modules.
- `organization_enabled_programs` grants a tenant permission to instantiate a template.
- `program_modules` is the runtime module state for a concrete program.
- Template default changes do not silently alter existing programs.

## Required migration

Apply migrations through:

```bash
supabase db push
```

For a linked development project, confirm migration `074_organization_onboarding.sql` appears in the migration history before using the new platform pages.

## Test-user setup

Never commit a service-role key or shared test password. After onboarding a disposable development organization, run:

```bash
SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="development-service-role-key" \
TEST_ORGANIZATION_ID="organization-uuid" \
TEST_PROGRAM_ID="program-uuid" \
TEST_USER_PASSWORD="temporary-strong-password" \
TEST_EMAIL_DOMAIN="your-test-domain.example" \
pnpm test:auth-users
```

The script creates or refreshes Platform Superadmin, Organization Owner, Organization Admin, Program Manager, Captain, Member, Suspended, and Outsider accounts. Use development only.

## Acceptance matrix

For every account, verify navigation and direct URLs as well as database writes:

- Platform Owner can manage global templates and all organizations.
- Platform Superadmin can onboard and manage assigned organizations but cannot create templates.
- Organization Owner/Admin can manage their tenant but cannot access platform administration.
- Program Manager cannot access organization users/settings and can operate only in assigned programs.
- Captain writes succeed only for allowed enabled modules.
- Member has no privileged write access.
- Suspended and pending memberships provide no active authority.
- Outsiders and cross-organization URLs return no protected tenant data.
- Disabling a module hides its UI and causes its protected database write to fail.
- The final Organization Owner cannot be demoted or suspended.
