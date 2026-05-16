<<<<<<< HEAD
# ou-soccer-manager
manage ou soccer
=======
# OU Soccer Manager

Production-ready MVP for managing a recurring soccer season with Supabase, Next.js App Router, TypeScript, Tailwind CSS, manual payments, attendance, dropouts/replacements, ledger entries, stats, and WhatsApp paste imports.

## Stack

- Next.js App Router and React
- TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL
- Supabase client for database access
- Zod validation
- Modular WhatsApp parser interface with a rule-based implementation
- Vitest for core utility tests

## Install

```bash
npm install
```

## Supabase Setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
WHATSAPP_PARSER_PROVIDER=rule
OPENAI_API_KEY=
OPENAI_WHATSAPP_PARSER_MODEL=gpt-4.1-mini
GEMINI_API_KEY=
GEMINI_WHATSAPP_PARSER_MODEL=gemini-2.0-flash
```

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the browser-safe key shown in newer Supabase projects. Older projects may call this the anon key; `NEXT_PUBLIC_SUPABASE_ANON_KEY` is still supported as a fallback. `SUPABASE_SECRET_KEY` is only for server-side seed/admin operations. Older projects may call this `SUPABASE_SERVICE_ROLE_KEY`, which is still supported as a fallback. Never expose the secret/service role key in browser code.

## Database Migrations

Run the SQL in:

```text
supabase/migrations/001_initial_schema.sql
```

You can paste it into the Supabase SQL editor or run it through the Supabase CLI:

```bash
supabase db push
```

The migration creates tables, indexes, views, triggers, RLS policies, and the attendance report RPC.

## Seed Data

After migrations:

```bash
npm run seed
```

Seed login:

```text
admin@ousoccer.local
ChangeMe123!
```

The seed clears app data and creates/updates only the admin login. No players, seasons, sessions, payments, attendance, goals, or dropout samples are created.

If `SEED_ADMIN_EMAIL` is not set and the Supabase project already has exactly one auth user, the seed script promotes that existing auth user to admin. If multiple auth users exist, set `SEED_ADMIN_EMAIL` before running seed.

## Run Locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Tests

```bash
npm test
```

Covered areas:

- WhatsApp parser
- Balance calculation
- Remaining sessions calculation
- Dropout transfer ledger logic
- Role permission helper

## Main Routes

- `/login`
- `/signup`
- `/dashboard`
- `/seasons`
- `/sessions`
- `/players`
- `/payments`
- `/attendance`
- `/import-whatsapp`
- `/reports/payments`
- `/reports/attendance`
- `/reports/stats`
- `/settings`

## WhatsApp Import

Version 1 uses manual paste only. The parser extracts draft data for:

- Session date
- Players
- Payments
- Attendance
- Dropouts and replacements
- Scores
- Goals and assists
- Warnings for uncertain lines

Nothing is saved automatically. Admins review parsed rows, match names to players, choose season/session, then confirm.

## Adding OpenAI Parsing Later

The parser boundary is:

```ts
export interface WhatsAppParser {
  parse(input: string): Promise<ParsedWhatsAppImport>;
}
```

The app includes two parser implementations:

- `rule`: local rule-based parser, no API cost
- `openai`: OpenAI Structured Outputs parser, better for messy human WhatsApp text
- `gemini`: Google Gemini structured JSON parser, often a good free-tier option
- `ollama`: local Ollama model, no cloud API cost

To enable OpenAI parsing:

```bash
WHATSAPP_PARSER_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_WHATSAPP_PARSER_MODEL=gpt-4.1-mini
```

Restart `npm run dev` after changing `.env.local`.

The OpenAI parser still returns the same `ParsedWhatsAppImport` shape and still requires admin review before saving. If OpenAI fails or the key is missing, it falls back to the rule-based parser and adds a warning in the review.

To enable Gemini parsing:

```bash
WHATSAPP_PARSER_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
GEMINI_WHATSAPP_PARSER_MODEL=gemini-2.0-flash
```

Create a Gemini API key in Google AI Studio, then restart `npm run dev`. The Gemini parser uses structured JSON output and falls back to the rule parser if the API key, quota, or model call fails.

To enable local Ollama parsing:

```bash
WHATSAPP_PARSER_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_WHATSAPP_PARSER_MODEL=qwen2.5:7b
```

Install Ollama, run `ollama pull qwen2.5:7b`, then restart `npm run dev`. If the parser is using Ollama, the review warnings will include `Parsed with Ollama model ...`.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add the same environment variables from `.env.example`.
4. Run the Supabase migration in your production Supabase project.
5. Deploy.

## Notes

Payments are manually recorded by admins. Payment writes create ledger entries and audit logs. RLS enforces server/database permissions so client-side role checks are not the only protection.
>>>>>>> 399b4c3 (Initial OU Soccer Manager app)
