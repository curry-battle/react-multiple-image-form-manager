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
