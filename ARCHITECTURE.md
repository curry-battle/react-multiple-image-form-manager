# Architecture — `@curry-battle/react-multiple-image-form-manager`

## 設計方針

99% フォーム非依存の画像管理ロジックを中立コアに閉じ込め、フォームライブラリ毎の差分を薄いアダプタ（Port）で吸収する Ports & Adapters 構成。
RHF / TanStack Form のどちらからでも同一コアロジックを利用できる。

```
┌──────────────────────────────────────────────────────────────────┐
│                       消費側アプリケーション                       │
└─────────────────────┬──────────────────────┬─────────────────────┘
        RHF経路        ▼                       ▼     TanStack経路
┌─────────────────────────────┐  ┌─────────────────────────────────┐
│ ./react-hook-form           │  │ ./tanstack-form                 │
│  - useRhfImageFieldAdapter  │  │  - useTanstackImageFieldAdapter │
│  - useMultiImageInputCtrl   │  │  - useTanstackMultiImageCtrl    │
│  - MultiImageInputController│  │  - TanstackMultiImageController │
└──────────┬──────────────────┘  └──────────┬──────────────────────┘
           │ ImageFieldAdapter (port)        │
           └──────────────┬──────────────────┘
                          ▼
              ┌──────────────────────────┐
              │ core (root ".")          │
              │  - useMultiImageCore     │ ← フォーム非依存
              │  - ImageFieldAdapter     │
              │  - types / utils         │
              └──────────────────────────┘
```

## Port: `ImageFieldAdapter`

`src/core/ImageFieldAdapter.ts` で定義される中立インターフェース。

```ts
interface ImageFieldAdapter {
  images: readonly Image[];             // reactive
  setImages(next: Image[]): void;       // 配列全体を 1 回で置き換える
  validate(): Promise<void>;            // 検証は発火するだけ
  errors: ImagesError;                  // 中立エラー
}
```

## 中立エラーモデル

```ts
type ImageFieldError = { message?: string; type?: string; source?: unknown };
type SingleImageError = Partial<Record<ImageKey, ImageFieldError>>;
type ImagesError = {
  items: Array<SingleImageError | undefined>;  // 配列添字対応 per-item
  root: ImageFieldError[];                      // 配列レベル（maxImages 等）
};
```

`useMultiImageCore` の戻り値:

- `itemsWithErrors: ImageWithErrors[]` — 可視画像のみ、`adapter.errors.items[originalIndex]` を付与
- `rootErrors: ImageFieldError[]` — `adapter.errors.root` をそのまま公開
- `handlers: { ... }` — add/fileChange/delete/move
- `raw: { watchedImages }` — debug 用途

## 純関数レイヤー: `imageListOps`

`src/core/imageListOps.ts` はフォーム非依存・React 非依存の純関数群。
各 handler は「`imageListOps` で次の配列を計算 → `adapter.setImages(next)` を 1 回呼ぶ」パターンで動作する。

- `addImage` / `replaceExistingImage` / `updateNewFile` / `markDeleteImage` / `removeNewImage` / `moveImage`
- 入力配列は不変（新配列を返す）
- 戻り値に操作成否を含む（例: `{ images: Image[]; added: boolean }`）

## アダプタ

### RHF (`useRhfImageFieldAdapter`)
- `{ form, name }` のみを受け取り、内部で `useFieldArray` / `useWatch` / `useFormState` を呼ぶ。
- `setImages` は `useFieldArray.replace` に委譲。
- errors は `useFormState` から自己取得し `normalizeRhfErrors` で中立化。

### TanStack Form (`useTanstackImageFieldAdapter`)
- 必ず `<form.Field name mode="array">` の **内部 React コンポーネント** 内で呼ぶ（rules-of-hooks）。
- Reactive subscription:
  - `useStore(field.store, s => s.value)` → `images`
  - `useStore(field.store, s => s.meta.errors)` → root meta errors
  - `useStore(form.store, s => s.errorMap)` → item path errors
- `setImages` は `form.setFieldValue(name, next)` に委譲。
- `validate()` は `form.validateField(name, validateCause ?? "change")`。
- `normalizeTanstackErrors` が bracket 記法の path key（例: `images[0].file`）を regex 解析。

## バンドル隔離

- `tsdown` で `react-hook-form/index` と `tanstack-form/index` を別エントリ → 別チャンクに出力。
- `react-hook-form` / `@tanstack/react-form` は `deps.neverBundle` かつ optional peer dep。
- ルート `.` は RHF / TanStack のいずれも re-export しない。
- `scripts/check-bundle-isolation.mjs` が build 後の `dist` を走査し、`dist/tanstack-form/*` から
  `react-hook-form` への、`dist/react-hook-form/*` から `@tanstack/react-form` への transitively な
  import が発生しないことを検証する。

## ディレクトリ構成

```
packages/react-multiple-image-form-manager/src/
├─ index.ts                       # ".": 中立 root
├─ core/
│  ├─ useMultiImageCore.ts        # フォーム非依存コア hook
│  ├─ imageListOps.ts             # 配列変換の純関数群
│  ├─ ImageFieldAdapter.ts        # ポート型
│  ├─ useImagePreviewUrl.ts       # blob URL 管理
│  ├─ normalizeErrorLeaf.ts       # エラー正規化ユーティリティ
│  ├─ types/                       # Image / Status / Error / Schema types
│  └─ __tests__/                   # FakeImageFieldAdapter / previewUrl テスト
├─ react-hook-form/
│  ├─ useRhfImageFieldAdapter.ts
│  ├─ useMultiImageInputController.ts   # 旧 API wrapper
│  ├─ MultiImageInputController.tsx     # Render Props
│  ├─ normalizeRhfErrors.ts
│  ├─ types.ts                          # RhfSingleImageError / RhfImagesError
│  └─ __tests__/
├─ tanstack-form/
│  ├─ useTanstackImageFieldAdapter.ts
│  ├─ useTanstackMultiImageController.ts
│  ├─ TanstackMultiImageController.tsx
│  ├─ normalizeTanstackErrors.ts
│  └─ __tests__/
└─ schemas/                        # zod / valibot
```
