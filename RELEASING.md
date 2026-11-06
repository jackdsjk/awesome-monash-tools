# Releasing

This project follows one rule: **every meaningful change ships a release.** No long-lived `next` branch, no unpublished work.

## Versioning

[SemVer](https://semver.org/): `0.x` while the tool surface is still settling.

- `patch` — fixes, docs, new tools that do not change existing behavior
- `minor` — new tools, new sources, changed tool schemas
- `major` — a breaking change to a tool name, parameter or return shape

## Checklist

```bash
# 1. Verify
npm run check          # tsc --noEmit + vitest
npm run smoke          # build first; protocol-level check of every server
npm run build

# 2. Bump and tag
npm version patch      # or minor / major; creates the commit and tag
git push --follow-tags

# 3. Publish
npm publish            # public package, latest tag

# 4. Release notes
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

## What ships

`npm publish` uploads `dist/`, `docs/`, both READMEs, `LICENSE` and `llms.txt`. `dist/` is built by `npm run build` and is intentionally not committed.

## After publishing

- Confirm the registry: `npm view awesome-monash-tools version`
- Confirm the bins: `npx -y awesome-monash-tools@latest --version`
- If a release is wrong, prefer a new patch over `npm unpublish`; the 72-hour unpublish window is a last resort.

## Pre-release

For a release candidate:

```bash
npm version prerelease --preid rc
npm publish --tag rc
```

`npx awesome-monash-tools@rc` installs it; `@latest` stays untouched until the stable publish.
