# @curry-battle/react-multiple-image-form-manager

[English](./README.md)

React 向けのヘッドレスな複数画像管理ライブラリ。
Discriminated Union と State Machine パターンを活用し、複数画像の追加・削除・並べ替え・差し替えを宣言的に管理します。

Hexagonal Architecture (Ports & Adapters) により、react-hook-form と TanStack Form の両方に対応しています。

## インストール

```bash
npm install @curry-battle/react-multiple-image-form-manager
```

フォームライブラリに合わせていずれかをインストール:

```bash
# React Hook Form
npm install react-hook-form

# TanStack Form
npm install @tanstack/react-form
```

### スキーマサポート (任意)

```bash
# Zod
npm install zod

# Valibot
npm install valibot
```

## 使い方 (React Hook Form)

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

Controller コンポーネントを使わず、hook を直接利用することも可能です。

```tsx
import { useMultiImageInputController } from "@curry-battle/react-multiple-image-form-manager/react-hook-form";

const form = useForm<MyForm>({ ... });
const { itemsWithErrors, rootErrors, handlers, raw } = useMultiImageInputController({
  form,
  name: "profileImages",
  constraints,
});
```

## 使い方 (TanStack Form)

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

## プレビュー表示 (useImagePreviewUrl)

新規追加画像 (`status: "new"`) はフォーム state に previewUrl を持ちません。
プレビューは項目ごとのコンポーネント内で `useImagePreviewUrl` を使って `file` から導出します
（blob URL の生成・破棄をコンポーネントの表示期間に閉じ込めるため。`image.previewUrl` の直接参照では New 画像のプレビューは表示されません）。

```tsx
import { useImagePreviewUrl, type Image } from "@curry-battle/react-multiple-image-form-manager";

function ImageItem({ image }: { image: Image }) {
  // New: file から object URL を生成（unmount / 差し替え時に自動 revoke）
  // Existing / ToBeDeleted: サーバURL (previewUrl) をそのまま返す
  const previewUrl = useImagePreviewUrl(image);
  return <img src={previewUrl} alt="" />;
}
```

hook のため `itemsWithErrors.map()` のコールバック内では呼べません。上記のように項目コンポーネントに切り出して使用してください。

## オプション Props

| Prop | 型 | 説明 |
|------|-----|------|
| `processFile` | `(file: File) => Promise<File>` | ファイル追加・差し替え時に前処理（リサイズ・変換等）を行う関数 |
| `uploadFile` | `(file: File) => Promise<{ uploadedUrl: string }>` | ファイル選択時に即アップロードする関数 |
| `onError` | `(error: MultiImageError) => void` | `processFile` の失敗や `maxImages` 超過時に呼ばれるエラーハンドラ |
| `constraints` | `ImageConstraints` | バリデーション制約（`acceptedTypes` / `maxFileSize` / `maxImages`） |
| `messages` | `CoreMessages` | i18n 用メッセージカスタマイズ |

## スキーマ

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

## エクスポート

| パス | 内容 |
|------|------|
| `@curry-battle/react-multiple-image-form-manager` | Core (types, utils, useMultiImageCore, useImagePreviewUrl, ImageFieldAdapter) |
| `@curry-battle/react-multiple-image-form-manager/react-hook-form` | RHF adapter (Controller, hook, adapter) |
| `@curry-battle/react-multiple-image-form-manager/tanstack-form` | TanStack Form adapter (Controller, hook, adapter) |
| `@curry-battle/react-multiple-image-form-manager/schemas/zod` | Zod スキーマファクトリ |
| `@curry-battle/react-multiple-image-form-manager/schemas/valibot` | Valibot スキーマファクトリ |

## Peer Dependencies

| パッケージ | バージョン | 必須 |
|-----------|-----------|------|
| react | ^19 | Yes |
| react-hook-form | ^7.50 | Optional |
| @tanstack/react-form | ^1.33 | Optional |
| zod | ^4.0.0 | Optional |
| valibot | ^1.0.0 | Optional |

## ライセンス

MIT
