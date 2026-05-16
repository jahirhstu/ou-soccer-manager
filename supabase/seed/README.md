Run the seed script after applying the consolidated initial schema:

```bash
npm run seed
```

It clears app data and creates/updates only one admin login.

Defaults:

```text
admin@ousoccer.local / ChangeMe123!
```

You can override these with `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, and `SEED_ADMIN_NAME`.

If `SEED_ADMIN_EMAIL` is not set and your Supabase project already has exactly one auth user, the seed script promotes that existing auth user to admin. If multiple auth users exist, set `SEED_ADMIN_EMAIL` explicitly.
