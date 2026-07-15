# OU Soccer Mobile

Expo/React Native client for the existing OU Soccer Manager backend. It uses the same Supabase project, users, organization memberships, roles, and row-level security policies as the web application.

## Setup

1. Copy `.env.example` to `.env`.
2. Use the same browser-safe Supabase values configured for the web app:

```text
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Never add the Supabase secret/service-role key to the mobile application.

3. Install and start:

```bash
pnpm install
pnpm start
```

Use `pnpm ios` or `pnpm android` when a simulator/emulator is available.

## Authorization

- `AuthProvider` restores the Supabase session and resolves the user's organization membership.
- Organization owners receive the effective `admin` role, matching the web application.
- `features.ts` controls which native features are visible and which roles receive write UI.
- Supabase row-level security remains the security boundary for every query and mutation.
- A hidden or disabled mobile control is usability behavior, not authorization by itself.

## Current migration stage

The authentication and role-aware application shell are implemented. Feature entries mirror the existing web navigation and are ready to be replaced incrementally with native screens and Supabase-backed queries/mutations.
