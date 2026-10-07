# Phase 2 Supabase setup

1. Apply `migrations/202610010001_phase2_auth.sql` in the Supabase SQL editor, then run `seed.sql`.
2. The migration installs the `auth.users` email trigger, profile creation trigger, profile protection trigger, RLS policies, and the private `avatars` bucket.
3. In **Authentication > Providers > Email**, keep **Confirm email** enabled.
4. In **Authentication > URL Configuration**, set the Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` as a redirect URL.
5. Run `tests/security.sql` after applying the migration. Replace the placeholder UUIDs in its commented RLS check with two test users to verify hidden profile access.

6. Apply the phase 3 migrations in order, including `202610070003_story_media_paths.sql`. The stories bucket must remain private; the migration backfills `stories.media_path` and permits signed reads only for active story objects.

The allowed domain is defined in `config/college.ts` for the UI and duplicated as a strict database function in the migration because PostgreSQL cannot import TypeScript configuration. Keep both values synchronized when changing institutional domains.