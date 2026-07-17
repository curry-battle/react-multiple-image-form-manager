# react-multiple-image-form-manager

[日本語](./README.ja.md)

[![CI](https://github.com/curry-battle/rhf-zod-form-with-multiple-images/actions/workflows/e2e.yml/badge.svg)](https://github.com/curry-battle/rhf-zod-form-with-multiple-images/actions/workflows/e2e.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Headless React library for managing multiple images — add, delete, reorder, and replace — with built-in validation and preview URL handling.

Supports **React Hook Form** and **TanStack Form**, with optional **Zod** / **Valibot** schema integration.

## Features

- Headless (render-prop) API — bring your own UI
- Add / delete / reorder / replace images declaratively
- Discriminated Union types for type-safe image state (`new` / `existing` / `toBeDeleted`)
- `useImagePreviewUrl` hook for automatic blob URL lifecycle management
- `processFile` callback for client-side preprocessing (resize, convert, etc.)
- `uploadFile` callback for upload-on-select workflows
- Zod & Valibot schema factories with shared constraint config
- i18n-ready error messages

## Packages

| Package | Description |
|---------|-------------|
| [`packages/react-multiple-image-form-manager`](./packages/react-multiple-image-form-manager/) | Core library (`@curry-battle/react-multiple-image-form-manager`) |
| [`examples/profile-form`](./examples/profile-form/) | Example app with React Hook Form |
| [`examples/profile-form-tanstack`](./examples/profile-form-tanstack/) | Example app with TanStack Form |

## Quick Start

```bash
pnpm install
```

### Run example apps

```bash
# React Hook Form example
pnpm run dev:example:rhf

# TanStack Form example
pnpm run dev:example:tanstack
```

### Library development

```bash
# Build
pnpm run build

# Unit tests (Vitest Browser Mode)
pnpm run test

# E2E tests (Playwright)
pnpm run test:e2e

# Type check
pnpm run typecheck

# Lint & format (Biome)
pnpm run check
```

## Documentation

See the [library README](./packages/react-multiple-image-form-manager/README.md) for full API documentation, usage examples, and export map.

## Architecture

This project uses **Hexagonal Architecture (Ports & Adapters)** to keep 99% of the image management logic form-agnostic. See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

```
App ─┬─ react-hook-form adapter ─┐
     └─ tanstack-form adapter  ──┤
                                  └─▶ core (useMultiImageCore, imageListOps)
```

## License

[MIT](./LICENSE)
