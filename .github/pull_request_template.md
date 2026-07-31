## Summary

<!-- One sentence describing what this PR does. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Data update (new region or updated values in `data/regions.json`)
- [ ] Documentation / chore

## Checklist

- [ ] `cd backend && npm test` passes with no new failures
- [ ] `cd backend && npx tsc --noEmit` passes clean
- [ ] `cd frontend && npx tsc --noEmit` passes clean
- [ ] `cd frontend && npm run build` succeeds
- [ ] If the API shape changed: `docs/SCHEMA.md` was updated first, then the Zod schema, then the frontend type
- [ ] If new data values were added to `data/regions.json`: each value has `source_url`, `last_verified`, and `basis`
- [ ] I have described below what I verified by hand

## What I verified by hand

<!-- If this was AI-assisted, describe the specific steps you ran yourself (e.g.
     "ran the estimate endpoint against the two example sites, checked ranking
     output matched expectation"). A PR with no manual verification step will not
     be merged. -->

## Related issues

<!-- Closes #... -->
