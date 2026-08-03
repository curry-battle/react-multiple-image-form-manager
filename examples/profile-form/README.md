# Form with Multiple Image Uploads Example

[日本語](./README.ja.md)

An example form implementation handling multiple image uploads using React Hook Form and Zod in a React + Vite environment.

Demonstrates a user profile update use case that manages multiple images.

## Overview

Using React Hook Form's `useFieldArray` for image management often leads to tangled implementations:

- Image previews require handling both server URLs (S3) and locally generated `URL.createObjectURL()` blob URLs
- On submit, determining which images are unchanged, newly added, or need deletion by comparing initialValues against current form state becomes error-prone
- Logic and UI become tightly coupled

This example uses Discriminated Unions and State Machine patterns to manage these complexities declaratively, with a Controller pattern to separate business logic from UI rendering.

## Assumptions

The form handles: updating existing (server-fetched) images, deleting existing images, adding new images, and reordering across both new and existing images.

Files are uploaded directly to S3 via presigned URLs from the frontend, without passing files through the backend.

The backend API is assumed to provide:

- Get S3 presigned URL (retrieval only, no DB update)
- Update DB (persist metadata including uploaded S3 URLs)

## Quick Start

```bash
# From the repository root
pnpm install

pnpm run dev:example:rhf
```

## How it works

The transfer to S3 starts the moment a file is picked, and **the item shows up without waiting for it**. If transfers are still running when the user hits save, that is where they are awaited.

```
[file picked]
  handlers.handleAdd(file)                        ProfileForm.tsx
    → a New item enters `items` and renders right away
    → uploadFile starts in the background (not awaited)

  handleUploadFile(file)                          ProfileForm.tsx
    → API.getPresignedUrl()                       api.ts   no DB write
    → API.uploadToS3()                            api.ts   PUT straight to S3
    → returns { uploadRef }                                reference to the transfer

  on completion, the library rebuilds that Image with uploadRef attached and
  replaces the whole array in form state (the original object is never mutated)
    → it appears in the JSON dump under 画像の状態 at the bottom of the page
    → from then on, "has it transferred?" is just whether that value exists

[save pressed]
  uploads.wait()                                  ProfileForm.tsx
    → waits for every running transfer to finish
    → ok: false — surface failedTempIds and stop
    → ok: true  — hands back images / deletedIds

  API.updateUserProfile(id, name, images, deletedIds)   api.ts
```

### What is visible while transfers run

| What you want | Where it comes from |
|---|---|
| Is this image transferring / did it fail | `items[].uploadState` (passed to `FormMultiImageItem`) |
| How many are in flight | `uploads.pending.length` |
| Failed items | `uploads.failed` → retry with `uploads.retry(tempId)` |
| Transfer progress | `items[].uploadState.progress` (when `uploadFile` reports it via `ctx.onProgress`) |

`FormMultiImageItem` renders the in-flight state, the failure state with a retry link, and the percentage. **The mock API here never reports progress**, though, so in practice only "アップロード中" shows up. To get percentages, call `ctx.onProgress(sent / total)` inside `handleUploadFile` (e.g. from `XMLHttpRequest`'s `upload.onprogress`).

### What gets sent on save

The `images` returned by `uploads.wait()` are visible items only, **in display order**. Each entry is one of:

```ts
{ id: "id of an existing image" }   // already on the server
{ uploadRef: "transfer reference" } // uploaded during this session
```

(without `uploadFile`, new images come back as `{ file, tempId }` instead)

`uploadRef` is whatever `uploadFile` returned. **Here it is an S3 URL**, but the library does not assume that. Other setups return just the S3 key, or an id issued by your backend (an upload token, for instance). Since it is not guaranteed to be displayable, previews come from `file` (`useImagePreviewUrl`), not from `uploadRef`. Existing images carry a real URL under the separate name `uploadedUrl`.

There is no `order` field. **The array order is the display order**, so the receiving side just reads the index.

Deletions are not in `images`; they come back as `deletedIds`. An API that treats "missing from the array" as deleted can ignore them.

Replacing an existing image is modelled as "delete the old one + add a new one", so the old id lands in `deletedIds` and the new `uploadRef` in `images`.

### Saving without waiting

Use `uploads.getReady()` instead of `uploads.wait()` to save with whatever is ready right now. It is synchronous and cannot fail.

```ts
const ready = uploads.getReady();
// ready.excludedTempIds — items left out this time. Tell the user.
```

Excluded items stay in the form and keep transferring, so the next save includes them. Mid-replacement is safe too: the original stays in place instead of being deleted, so **the old image is never dropped without its replacement**.

## Directory Structure

```
src/
	api/
		api.ts                  # Mock API calls
	components/
		FormMultiImageItem.tsx  # Image display component for MultiImageController
		ProfileForm.tsx         # Form root using RHF
	types/
		UserProfile.ts          # Form data types
		schemas/
			UserProfileSchema.ts    # Zod schema for the form
	libs/
		Uuid/                   # UUID type utilities
```

## E2E Tests

E2E tests are provided using Playwright.

```bash
# Run from the repository root

# Install browsers (first time only)
pnpm run test:e2e:install

# Run tests
pnpm run test:e2e

# Debug in UI mode
pnpm run test:e2e:ui
```

## Tech Stack

- Framework: React 19
- Bundler: Vite
- Language: TypeScript
- Form: react-hook-form
- Validation: zod
- Styling: Tailwind
- Lint/Format: Biome
- E2E: Playwright
