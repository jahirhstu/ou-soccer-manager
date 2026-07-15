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

## Implemented native workflows

The mobile client includes the web application's role-aware feature set: organization/program switching, sessions, attendance, teams, fixtures, scores, goals and assists, voice scoring, lineups, performance ratings, leagues, programs, seasons, players, users, payments, expenses, fee waivers, payment notifications and reminders, WhatsApp import, settings, and reporting views.

Admin-only mutations are sent to authenticated mobile API routes in the existing Next.js application. Those routes validate the bearer token, active organization membership, effective role, and organization ownership of referenced records before writing. Direct reads continue to use Supabase row-level security.

## Test locally

Run the Next.js application so secured mobile API routes are available, then set `EXPO_PUBLIC_WEB_URL` to a URL reachable from the simulator/device. Use `http://10.0.2.2:3000` for a typical Android emulator; iOS Simulator can normally use `http://localhost:3000`. A physical device needs the computer's LAN URL or a deployed HTTPS URL.

```bash
pnpm install
pnpm typecheck
pnpm ios
# or
pnpm android
```

Test with admin, captain, and player accounts. The home screen and write controls change for each effective organization role. Production bundles can be checked with `expo export --platform ios` and `expo export --platform android`.
