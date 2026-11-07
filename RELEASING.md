# Releasing

One rule: **every meaningful change ships a release.** No long-lived `next` branch, no unpublished work.

## Versioning

[SemVer](https://semver.org/): `0.x` while the tool surface is still settling.

- `patch` — fixes, docs, new tools that do not change existing behavior
- `minor` — new tools, new sources, changed tool schemas
- `major` — a breaking change to a tool name, parameter or return shape

## How a release happens

Publishing runs from GitHub Actions with **trusted publishing (OIDC)** — no npm token lives in this repository.

```bash
# 1. Verify locally
npm run check
npm run smoke
npm run build

# 2. Bump the version and commit
npm version patch --no-git-tag-version
git commit -am "Release v$(node -p "require('./package.json').version")"
git push

# 3. Tag: this triggers .github/workflows/release.yml
git tag "v$(node -p "require('./package.json').version")"
git push --tags

# 4. After the workflow succeeds
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

The workflow checks out the tag, runs the full test suite, builds `dist/`, and publishes with provenance.

## One-time setup

On npmjs.com, open the package → **Settings → Trusted publishing → Add a trusted publisher**:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `jackdsjk` |
| Repository | `awesome-monash-tools` |
| Workflow filename | `release.yml` |
| Environment | leave empty |

After that every tag push publishes automatically. No token, no one-time password.

## Manual fallback

If Actions is unavailable, publish from a machine with 2FA:

```bash
npm publish
```

If npm reports `Cannot publish over previously staged version`, the publish was staged instead of completed: run `npm stage list`, then `npm stage approve <stage-id>` with your one-time code. A staged reservation can block a version number without ever publishing it, in which case bump the patch version and publish again.

## What ships

`npm publish` uploads `dist/`, `docs/` (both languages), both READMEs, `LICENSE`, `llms.txt` and `RELEASING.md`. `dist/` is built in CI and is intentionally not committed.
