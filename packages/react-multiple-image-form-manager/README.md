# @curry-battle/react-multiple-image-form-manager

[日本語](./README.ja.md)

Headless React library for managing multiple images.
Uses Discriminated Union and State Machine patterns to declaratively manage adding, deleting, reordering, and replacing images.

Supports both react-hook-form and TanStack Form via Hexagonal Architecture (Ports & Adapters).

## Installation

```bash
npm install @curry-battle/react-multiple-image-form-manager
```

Install one of the supported form libraries:

```bash
# React Hook Form
npm install react-hook-form

# TanStack Form
npm install @tanstack/react-form
```

### Schema support (optional)

```bash
# Zod
npm install zod

# Valibot
npm install valibot
```

## Usage (React Hook Form)

### MultiImageInputController

```tsx
import { ImageFormStatus, type Image } from "@curry-battle/react-multiple-image-form-manager";
import { MultiImageInputController } from "@curry-battle/react-multiple-image-form-manager/react-hook-form";

const form = useForm<MyForm>({ ... });

<MultiImageInputController
  form={form}
  name="profileImages"
  constraints={constraints}
  onError={(error) => console.error(error.message)}
  render={({
    itemsWithErrors,
    rootErrors,
    handleAdd,
    handleFileChange,
    handleDelete,
    handleMove,
    raw,
  }) => {
    return (
      // UI implementation
    );
  }}
/>
```

### useMultiImageInputController

You can also use the hook directly without the Controller component.

```tsx
import { useMultiImageInputController } from "@curry-battle/react-multiple-image-form-manager/react-hook-form";

const form = useForm<MyForm>({ ... });
const { itemsWithErrors, rootErrors, handlers, raw } = useMultiImageInputController({
  form,
  name: "profileImages",
  constraints,
});
```

## Usage (TanStack Form)

```tsx
import { TanstackMultiImageController } from "@curry-battle/react-multiple-image-form-manager/tanstack-form";

const form = useForm({ ... });

<TanstackMultiImageController
  form={form}
  name="images"
  constraints={constraints}
  onError={(error) => console.error(error.message)}
  render={({
    itemsWithErrors,
    rootErrors,
    handleAdd,
    handleFileChange,
    handleDelete,
    handleMove,
    raw,
  }) => {
    return (
      // UI implementation
    );
  }}
/>
```

## Preview display (useImagePreviewUrl)

Newly added images (`status: "new"`) do not hold a previewUrl in form state.
Use `useImagePreviewUrl` inside a per-item component to derive the preview from `file`
(this confines blob URL creation/revocation to the component's display lifetime. Directly referencing `image.previewUrl` will not show previews for new images).

```tsx
import { useImagePreviewUrl, type Image } from "@curry-battle/react-multiple-image-form-manager";

function ImageItem({ image }: { image: Image }) {
  // New: generates an object URL from file (auto-revoked on unmount / replacement)
  // Existing / ToBeDeleted: returns the server URL (previewUrl) as-is
  const previewUrl = useImagePreviewUrl(image);
  return <img src={previewUrl} alt="" />;
}
```

Since this is a hook, it cannot be called inside an `itemsWithErrors.map()` callback. Extract it into a per-item component as shown above.

## Optional Props

| Prop | Type | Description |
|------|------|-------------|
| `processFile` | `(file: File) => Promise<File>` | Preprocessor for file add/replace (resize, convert, etc.) |
| `uploadFile` | `(file: File) => Promise<{ uploadedUrl: string }>` | Upload immediately on file select |
| `onError` | `(error: MultiImageError) => void` | Error handler for `processFile` failures or `maxImages` exceeded |
| `constraints` | `ImageConstraints` | Validation constraints (`acceptedTypes` / `maxFileSize` / `maxImages`) |
| `messages` | `CoreMessages` | Custom error messages for i18n |

## Schema

### Zod

```ts
import { createImagesSchema } from "@curry-battle/react-multiple-image-form-manager/schemas/zod";

const imagesSchema = createImagesSchema({
  acceptedTypes: ["image/jpeg", "image/png"],
  maxImages: 5,
  idValidation: (id) => isValidId(id),
});
```

### Valibot

```ts
import { createImagesSchema } from "@curry-battle/react-multiple-image-form-manager/schemas/valibot";

const imagesSchema = createImagesSchema({
  acceptedTypes: ["image/jpeg", "image/png"],
  maxImages: 5,
  idValidation: (id) => isValidId(id),
});
```

## Exports

| Path | Contents |
|------|----------|
| `@curry-battle/react-multiple-image-form-manager` | Core (types, utils, useMultiImageCore, useImagePreviewUrl, ImageFieldAdapter) |
| `@curry-battle/react-multiple-image-form-manager/react-hook-form` | RHF adapter (Controller, hook, adapter) |
| `@curry-battle/react-multiple-image-form-manager/tanstack-form` | TanStack Form adapter (Controller, hook, adapter) |
| `@curry-battle/react-multiple-image-form-manager/schemas/zod` | Zod schema factory |
| `@curry-battle/react-multiple-image-form-manager/schemas/valibot` | Valibot schema factory |

## Peer Dependencies

| Package | Version | Required |
|---------|---------|----------|
| react | ^19 | Yes |
| react-hook-form | ^7.50 | Optional |
| @tanstack/react-form | ^1.33 | Optional |
| zod | ^4.0.0 | Optional |
| valibot | ^1.0.0 | Optional |

## License

MIT
