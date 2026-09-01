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

### useMultiImageInputController

Call it at form level so that `uploads` is reachable from your submit handler.

```tsx
import { useMultiImageInputController } from "@curry-battle/react-multiple-image-form-manager/react-hook-form";

const form = useForm<MyForm>({ ... });
const { items, rootErrors, handlers, uploads, raw } =
  useMultiImageInputController({
    form,
    name: "profileImages",
    constraints,
    uploadFile,
  });

const onSubmit = async (data: MyForm) => {
  const waited = await uploads.wait();
  if (!waited.ok) return;           // waited.failedTempIds
  await save({ images: waited.images });
};
```

### MultiImageInputController

Render-props sugar over the hook. Note that `uploads` is only available inside the render
callback, so a submit handler outside it needs the hook instead.

```tsx
import { MultiImageInputController } from "@curry-battle/react-multiple-image-form-manager/react-hook-form";

<MultiImageInputController
  form={form}
  name="profileImages"
  constraints={constraints}
  onError={(error) => console.error(error.message)}
  render={({
    items,
    rootErrors,
    handleAdd,
    handleFileChange,
    handleDelete,
    handleMove,
    uploads,
    raw,
  }) => {
    return (
      // UI implementation
    );
  }}
/>
```

## Usage (TanStack Form)

The same shape. The hook reads and writes through the form store, so it does not need to
sit inside `<form.Field mode="array">`.

```tsx
import { useTanstackMultiImageController } from "@curry-battle/react-multiple-image-form-manager/tanstack-form";

const form = useForm({ ... });
const { items, rootErrors, handlers, uploads, raw } =
  useTanstackMultiImageController({
    form,
    name: "images",
    constraints,
    uploadFile,
  });
```

```tsx
import { TanstackMultiImageController } from "@curry-battle/react-multiple-image-form-manager/tanstack-form";

<TanstackMultiImageController
  form={form}
  name="images"
  constraints={constraints}
  onError={(error) => console.error(error.message)}
  render={({
    items,
    rootErrors,
    handleAdd,
    handleFileChange,
    handleDelete,
    handleMove,
    uploads,
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

Since this is a hook, it cannot be called inside an `items.map()` callback. Extract it into a per-item component as shown above.

## Choosing an upload strategy

There is exactly one decision, and one follow-up.

```
Do you pass uploadFile?
├─ yes → upload on select. The library owns the transfer.
│          └─ before submitting:
│              ├─ uploads.wait()      … wait for every running add/replace and transfer
│              └─ uploads.getReady()  … don't wait; leave the unfinished ones out
│
└─ no  → the library never transfers. It hands you the File.
```

**There is no submit-time upload mode.** Leaving `uploadFile` out does not mean "upload on
submit" — it means the library stays out of transferring entirely, and `wait()` / `getReady()`
give you `{ file, tempId }` so you can do it whenever you like.

| | `uploadFile` set | not set |
|---|---|---|
| Who transfers | the library | you |
| When | on file select | you decide |
| `uploads.pending` / `failed` / `retry` | usable | always empty / no-op |
| `items[].uploadState` | pending / failed / progress | always `undefined` |
| `wait()` | waits for adds/replacements and transfers | waits for adds/replacements only |
| `getReady()` | leaves unfinished items out | leaves nothing out |
| Submit payload | `{ id } \| { uploadRef }` | `{ id } \| { file, tempId }` |

Calling `wait()` / `getReady()` is still worthwhile without `uploadFile`: they give you the
visible ordering and `deletedIds`.

## Upload on select (uploadFile / uploads)

When `uploadFile` is provided, the transfer starts as soon as a file is selected and
**does not block the item from appearing**. The item is added immediately (previewed from
`file`), the transfer runs in the background, and `uploadRef` is written back on success.

`uploadRef` is whatever `uploadFile` returns — a URL if you upload straight to permanent
storage, or an opaque token if you hand it to a register API. It is not validated as a URL
and is not usable for display.

This means the user can press submit while transfers are still running. Await
`uploads.wait()` in your submit handler to let them finish first.

```tsx
const waited = await uploads.wait();
if (!waited.ok) {
  // waited.failedTempIds — show them and offer uploads.retry(tempId)
  return;
}
// Send it as-is. It is a snapshot, so do not let the user reorder in between.
await save({ images: waited.images });
```

`waited.images` is the submit payload, not a projection of form state: visible items only,
**in display order**, each one either `{ id }` for an image the server already has or
`{ uploadRef }` for one you just transferred. There is no `order` field — the array order
*is* the order — and deletions are not in the list. An API that reads "anything missing from
the array is deleted" takes it unchanged.

For an API that wants deletions spelled out, `waited.deletedIds` carries the ids of the
existing images the user removed.

`wait()` also waits for `handleAdd` / `handleFileChange` calls that are still running.
Those handlers await before they write the selection to the form, so **until the call
finishes the picked file is not in the form yet** — without that wait it drops out of the
payload silently.
`processFile` widens that gap by the conversion it runs, but the wait applies with or
without it, to any handler call you did not await.

When the user re-picks a file for the same item, **the last pick always wins**, whichever
order the two conversions resolve in. The discarded call resolves to `false` because it
wrote nothing, and `wait()` does not wait for it. Deleting an item while a replacement is
running keeps it deleted.

**An `onError` with `type: "process_file"` is about a file, not an item.** A pick that was
already superseded — or whose item was deleted — still reports its own conversion failure,
even though it wrote nothing. And when the latest pick fails, the item keeps the file it
had: a discarded earlier pick is never resurrected. Word the message after the file, and
read the item's state from `items`.

The library does not block re-picking or deleting while a conversion runs. That is a UI
decision for your app; what the library guarantees is that the race cannot corrupt the
form and that the outcome above is what you get.

`waited.images` is built from the form values as of the moment the wait resolves, which
**is not necessarily what submit validated.** To line the two up exactly, re-validate after
`wait()` or block selection while it is pending.

Without `uploadFile` nothing transfers, so `wait()` waits only for running adds and
replacements before returning `ok`, and new items come back as `{ file, tempId }` to upload
yourself. Only that variant carries `tempId` — `{ id }` and `{ uploadRef }` go to the
server as-is, while `{ file }` is something you process, so it needs a key to point at when
one of them fails.

To save without waiting, use `uploads.getReady()`. It is synchronous and cannot fail:

```tsx
const ready = uploads.getReady();
// ready.excludedTempIds — tell the user these were not included this time
await save({ images: ready.images });
```

Excluded items **stay in the form**, so tell the user — otherwise their reappearance in a
later save reads as a bug. Items still in flight keep transferring and land in the next
save on their own; items in `uploads.failed` do not retry by themselves and stay excluded
until you call `uploads.retry(tempId)`. Cross-check `excludedTempIds` against
`uploads.failed` if you want to offer the two different follow-ups.

Replacements are handled: when the dropped item is the replacement for an existing image,
that original is put back at the same position instead of being deleted. Both travel
together on the next save, so a mid-replacement `getReady()` never deletes the old image
without adding the new one.

**`getReady()` does not wait for running adds or replacements.** A selection not yet
written to the form stays out of the payload — an add contributes no item at all, a
replacement contributes what the item held before it — and shows up in neither
`excludedTempIds` nor `uploads.pending`. If you rely on `getReady()`, track those calls
yourself and hold the save.

| Member | Type | Description |
|--------|------|-------------|
| `pending` | `string[]` | tempIds currently in flight |
| `failed` | `string[]` | tempIds whose transfer failed |
| `retry` | `(tempId: string) => Promise<boolean>` | Re-run a **failed** transfer. Returns `false` for anything else |
| `wait` | `() => Promise<UploadWaitResult>` | Wait for running adds/replacements and transfers, then hand back the payload |
| `getReady` | `() => ReadyImages` | Same payload without waiting. Synchronous, cannot fail |

> **Prefer the hooks.** `useMultiImageInputController` /
> `useTanstackMultiImageController` can be called at form level, so `uploads` is reachable
> from the submit handler directly. The render-props components keep it inside the render
> callback, and their payload is typed loosely (`{ id } | { uploadRef } | { file, tempId }`)
> because a render callback's parameter cannot be inferred reliably when the props are
> split on whether `uploadFile` is present. The loose type is a superset of what actually
> occurs, so it never lies — but passing it to a save API that rejects `{ file, tempId }`
> needs a cast.

Per-item progress is exposed as `uploadState` on each `items` entry:
`{ status: "pending", progress?: number }`, `{ status: "failed", error }`, or `undefined`.
`progress` is `0..1` and only present once `uploadFile` has reported it through
`ctx.onProgress`. Report as often as you like — reports that do not change the integer
percentage do not re-render. Estimating remaining time is left to you.

There is deliberately no `"done"`. That state would live only in memory and vanish on
remount, so an "uploaded" badge keyed to it would disappear when the field remounts.
Derive completion from `image.uploadRef`, which is part of form state.

A failed transfer keeps the item in the list so the selection is not silently lost —
`onError({ type: "upload_file" })` fires asynchronously, after `handleAdd` has already
resolved `true`. A transfer that resolves without a usable `uploadRef` is treated as a
failure rather than a success.

Under `<StrictMode>` in development, React runs effect cleanup once before re-running the
effect, so a transfer started on mount is aborted and re-issued: `uploadFile` is called
twice, but only one call survives to write its result back. Honoring `ctx.signal` cancels
the abandoned one; ignoring it leaves an orphaned upload for your storage lifecycle rules
to reclaim.

`uploads.wait()` requires the hook to be mounted at submit time. Calling the hook at form
level satisfies this by construction, including wizard steps that unmount the image UI.

Whenever a `new` item without an `uploadRef` appears in form state — on mount, after a
remount, or when initial values arrive asynchronously — its transfer is (re-)issued.
Transfers that already failed are left alone; use `uploads.retry(tempId)` for those.

## Utilities (ImageUtils)

| Function | Signature | Use |
|---|---|---|
| `createNew` | `(tempId, file, uploadRef?) => ImageNew` | Build a new item |
| `updateNewImageFile` | `(image: ImageNew, newFile) => ImageNew` | Swap the file, keeping `tempId` and the replacement link |
| `replaceExisting` | `(image: ImageExisting, newFile) => { deletedImage, newImage }` | Replace an existing image. **Use this rather than pairing `markDelete` + `createNew` by hand** — it records the link that lets `getReady()` restore the original |
| `markDelete` | `(image: ImageExisting) => ImageToBeDeleted` | Mark for deletion |
| `markSaved` | `(image: ImageUploaded, { id, previewUrl, uploadedUrl }) => ImageExisting` | Promote a saved item to `existing` |

`markSaved` promotes an item once the server has registered it, so a later save does not send
it again as new. The argument type says "it must have finished transferring to be promoted".

```ts
const promoted = ImageUtils.markSaved(image, {
  id: saved.id,
  previewUrl: saved.url,   // both are required: uploadRef may be an opaque
  uploadedUrl: saved.url,  // token, so no URL can be derived from it
});
```

It earns its keep when a save can partially succeed. An API that saves everything in one
atomic request never leaves items half-registered, so you will not need it there.

## Optional Props

| Prop | Type | Description |
|------|------|-------------|
| `processFile` | `(file: File) => Promise<File>` | Preprocessor for file add/replace (resize, convert, etc.) |
| `uploadFile` | `(file: File, ctx: { signal: AbortSignal; onProgress: (fraction: number) => void }) => Promise<{ uploadRef: string }>` | Upload on file select, without blocking. `ctx.signal` aborts on unmount / file replacement; honoring it is optional (results are discarded either way). `ctx.onProgress` reports `0..1`. Write `(file) => ...` if you need neither |
| `onError` | `(error: MultiImageError) => void` | Error handler for `processFile` failures, `uploadFile` failures, or `maxImages` exceeded |
| `constraints` | `ImageConstraints` | Validation constraints (`acceptedTypes` / `maxFileSize` / `maxImages`) |
| `messages` | `CoreMessages` | Custom error messages for i18n |

**`processFile` must always settle its promise.** `uploads.wait()` waits for the handler
call that awaits it, so a conversion that neither resolves nor rejects makes saving hang —
with or without `uploadFile`. There is no `signal` to abort with, so put a timeout on
anything that can stall and reject on it; the rejection arrives as `onError` with
`type: "process_file"` and the item keeps the file it had.

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
