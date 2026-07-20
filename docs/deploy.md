# Release Procedure

## Overview

```
PR merge → release-drafter updates Draft Release
                    ↓
Actions > Publish Package > Run workflow (manual)
                    ↓
CI → pnpm publish to GitHub Packages
                    ↓
Draft Release tag updated to match package.json version
                    ↓
Review Draft Release on GitHub → Publish
```

Package is published to GitHub Packages **before** the tag is created.
This ensures that a publish failure never burns an immutable tag.

## Steps

### 1. Bump version

Update `packages/react-multiple-image-form-manager/package.json` `version` field and merge to `main`.

### 2. Run publish workflow

Go to **Actions > Publish Package > Run workflow** on the `main` branch.

The workflow:

1. Runs CI (build, typecheck, lint, unit tests, e2e)
2. Publishes the package to GitHub Packages
3. Updates the release-drafter Draft Release tag to `v<version>`

### 3. Publish the Draft Release

Go to **Releases** on GitHub, review the Draft Release, edit release notes if needed, then click **Publish release**.

This creates the git tag and finalizes the release.

## Troubleshooting

### publish job failed

No tag or release was created. Fix the issue and re-run the workflow.

### update-draft job failed (publish succeeded)

The package is already on GitHub Packages. Re-run only the **update-draft** job from the Actions UI.

### Draft Release was not created by release-drafter

If no Draft Release exists, the workflow creates a new one with `--generate-notes`.

### Ran workflow from a non-main branch

The `publish` job is skipped (`if: github.ref == 'refs/heads/main'`). Re-run from `main`.
