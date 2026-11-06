## Summary

- What changed and why:

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run verify` passes (`build` + `check:pages` + `check:contributing`)
- [ ] `npm run test:security` passes
- [ ] If `supabase/schema.sql` changed: `SCHEMA_VERSION` bumped and `supabase/schema-tests.sql` updated
- [ ] Zero secrets, private keys, or raw HTML injection added
