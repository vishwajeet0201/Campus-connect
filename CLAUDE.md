@AGENTS.md

# Working agreement for Claude Code
- Spec-driven: every feature has a spec in docs/specs/NN-name.md. Read the spec
  before coding. If code and spec disagree, stop and tell me.
- Plan first for anything touching the database, auth, RLS or storage.
- Never edit an applied migration. New migration per change, rerunnable
  (drop ... if exists / create or replace), 14-digit timestamp filenames.
- Verification gate before saying "done": npm run lint, npx tsc --noEmit,
  npm test, npm run build, plus the relevant e2e and RLS tests. Paste the
  output summary. No gate, no done.
- Check every column the code uses against the migrations (past bugs came
  from missing columns).
- Surface rules: glass only for floating controls; content flat; sheets
  opaque; no glass on glass; max 2 blur layers on screen.
- Security: RLS on every table, no service-role key in client code or git,
  secrets only in .env.local, validate input with zod at every boundary.
- Small commits, conventional messages (feat:, fix:, chore:, test:), one
  branch per milestone (feat/m3-chat). Never commit .env* or map-source images.
- Keep answers short: what changed, what you verified, what I must do manually.
