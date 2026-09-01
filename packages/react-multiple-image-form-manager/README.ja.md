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

### useMultiImageInputController

フォームレベルで呼びます。こうすると送信ハンドラから `uploads` に直接届きます。

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

フックの糖衣です。`uploads` は render コールバックの内側でしか取れないため、外側の送信ハンドラから使うならフックを選んでください。

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

## 使い方 (TanStack Form)

形は同じです。フックはフォームストア経由で読み書きするので、`<form.Field mode="array">` の内側に置く必要はありません。

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

hook のため `items.map()` のコールバック内では呼べません。上記のように項目コンポーネントに切り出して使用してください。

## 転送方式の選び方

決めることは 1 つ、その先の分岐が 1 段だけです。

```
uploadFile を渡す？
├─ 渡す   → 選択時アップロード。転送はライブラリが持つ
│            └─ 送信前に:
│                ├─ uploads.wait()      … 走行中の追加・差し替えと転送を全部待つ
│                └─ uploads.getReady()  … 待たずに、未完のものを外す
│
└─ 渡さない → ライブラリは転送しない。File を手渡す
```

**submit 時アップロードという方式は持っていません。** `uploadFile` を渡さないのは「submit 時に転送する」という意味ではなく、**ライブラリが転送に一切関与しない**という意味です。`wait()` / `getReady()` が `{ file, tempId }` を返すので、好きなタイミングで転送してください。

| | `uploadFile` あり | なし |
|---|---|---|
| 転送するのは | ライブラリ | 利用側 |
| タイミング | ファイル選択時 | 利用側が決める |
| `uploads.pending` / `failed` / `retry` | 使える | 常に空 / 何もしない |
| `items[].uploadState` | pending / failed / progress | 常に `undefined` |
| `wait()` | 追加・差し替えと転送を待つ | 追加・差し替えだけ待つ |
| `getReady()` | 未完のものを外す | 何も外さない |
| 送信素材 | `{ id } \| { uploadRef }` | `{ id } \| { file, tempId }` |

`uploadFile` を渡さない場合でも `wait()` / `getReady()` を呼ぶ意味はあります。**可視順の配列と `deletedIds`** が得られるためです。

## 選択時アップロード (uploadFile / uploads)

`uploadFile` を設定すると、ファイルを選んだ時点で転送が始まります。**転送の完了は項目の表示をブロックしません。** 項目はすぐ配列に入り（プレビューは `file` から描画）、転送は裏で走り、成功したら `uploadRef` が書き戻されます。

`uploadRef` は `uploadFile` が返した値そのものです。恒久ストレージへ直接置く構成では URL になりますが、一時領域へ置いて登録 API に引き渡す構成では不透明なトークンになります。URL としての検証はかけていないため、表示には使えません。

転送中でもユーザーは保存を押せます。送信ハンドラで `uploads.wait()` を await して完了させてください。

```tsx
const waited = await uploads.wait();
if (!waited.ok) {
  // waited.failedTempIds を提示して uploads.retry(tempId) の導線を出す
  return;
}
// そのまま送れる。スナップショットなので、この間にユーザーへ並べ替えさせないこと
await save({ images: waited.images });
```

`waited.images` はフォーム state の写しではなく送信素材です。**可視項目のみ・表示順**で、各要素は既にサーバにある画像なら `{ id }`、今回転送したものなら `{ uploadRef }` のどちらかです。`order` フィールドはありません（配列の順序が順序そのものです）。削除対象も含みません。「配列に無いものは削除」と解釈する API にはそのまま渡せます。

削除を明示する API には `waited.deletedIds`（ユーザーが外した既存画像の id）を使ってください。

`wait()` は走行中の `handleAdd` / `handleFileChange` の完了も待ちます。これらの handler は選択をフォームへ反映する前に await を挟むため、**呼び出しが終わるまでは選んだファイルがフォームに現れません。** 待たなければその選択は送信素材から黙って落ちます。`processFile` を設定していると変換の分だけその間が長くなりますが、待ちはその有無によらず、await していない handler の呼び出しすべてに掛かります。

同じ項目でファイルを選び直したときは、変換がどちらの順で解決しても**残るのは最後に選んだファイル**です。捨てられた側の `handleFileChange` は何も書かなかったので `false` を返し、`wait()` もそれを待ちません。走行中の差し替えがある項目を削除した場合は削除が勝ちます。

**`type: "process_file"` の `onError` は、項目ではなくファイルについての通知です。** 既に後着へ置き換えられた選択も、項目ごと削除された選択も、自分の変換が失敗すれば（何も書かないにもかかわらず）通知します。また後着の変換が失敗したときは、項目は元のファイルのまま残ります（捨てた先着が復活することはありません）。メッセージはファイルを主語にして、項目の状態は `items` から読んでください。

「変換中は選び直しも削除も受け付けない」という抑止はライブラリでは行いません。それはアプリの UI 方針であり、ライブラリが保証するのは競合が起きないことと、受け付けたときの結果だけです。

`waited.images` は待ちが解決した時点のフォーム値から組まれます。**submit が検証した値と一致するとは限りません。**厳密に揃えたい場合は `wait()` のあとに再検証するか、待っている間の選択を止めてください。

`uploadFile` を設定していない場合は転送が無いので、`wait()` は走行中の追加・差し替えだけを待って `ok` を返し、新規項目は `{ file, tempId }` の形で返ります（転送は消費側で行います）。`tempId` が付くのはこの形だけです。`{ id }` と `{ uploadRef }` はそのままサーバへ送る値ですが、`{ file }` は消費側が処理するものなので、失敗した項目を指し示すキーが要るためです。

待たずに保存する場合は `uploads.getReady()` を使います。同期関数で、失敗しません。

```tsx
const ready = uploads.getReady();
// ready.excludedTempIds — 今回含まれなかったことをユーザーに伝える
await save({ images: ready.images });
```

除外した項目は**フォームに残ります**。伝えないと、後の保存で現れたときにバグに見えます。走行中の項目は転送が続くので次回の保存に入りますが、`uploads.failed` の項目は自動再試行しないため、`uploads.retry(tempId)` を呼ぶまで除外され続けます。導線を分けるなら `excludedTempIds` と `uploads.failed` を突き合わせてください。

差し替え中でも安全です。除外する項目が既存画像の差し替えだった場合、元画像は削除されず同じ位置に戻ります。次の保存で差し替え後と一緒に送られるので、**元画像だけが消える状態にはなりません**。

**`getReady()` は走行中の追加・差し替えを待ちません。** フォームへ反映される前の選択は素材に入らず（追加なら項目自体が無く、差し替えなら反映前の内容が入ります）、`excludedTempIds` にも `uploads.pending` にも現れません。`getReady()` を使う構成では、反映の完了は消費側が握って保存を止めてください。

| メンバ | 型 | 説明 |
|--------|-----|------|
| `pending` | `string[]` | 転送中の tempId |
| `failed` | `string[]` | 転送に失敗した tempId |
| `retry` | `(tempId: string) => Promise<boolean>` | **失敗した**転送を再実行する。それ以外は `false` |
| `wait` | `() => Promise<UploadWaitResult>` | 走行中の追加・差し替えと転送を待ってから送信素材を返す |
| `getReady` | `() => ReadyImages` | 待たずに同じ素材を返す。同期・失敗しない |

> **フックを既定の入口にしてください。** `useMultiImageInputController` / `useTanstackMultiImageController` はフォームレベルで呼べるので、送信ハンドラから `uploads` に直接届きます。render-props コンポーネントは render コールバックの内側にしか出せず、送信素材の型も緩いまま（`{ id } | { uploadRef } | { file, tempId }`）です。props を `uploadFile` の有無で分けると判別子が関数型になり、render コールバックの引数推論が壊れるためです。緩い型は実行時に現れる形の上位集合なので嘘にはなりませんが、`{ file, tempId }` を受け付けない保存 API へ渡すにはキャストが要ります。

項目ごとの状態は `items` の各要素の `uploadState` から取れます。`{ status: "pending", progress?: number }` / `{ status: "failed", error }` / `undefined` のいずれかです。`progress` は 0..1 で、`uploadFile` が `ctx.onProgress` で報告した後だけ値を持ちます。報告の頻度に制限はありません（整数パーセントが変わらない報告では再レンダーしません）。残り時間の推定は消費側で行ってください。

`"done"` は意図的に公開していません。その状態はメモリ上にしか無く remount で消えるため、それに紐づけた「アップロード済み」表示がフィールドの再マウントのたびに消えます。完了の判定はフォーム state に永続する `image.uploadRef` から導出してください。

転送に失敗しても項目はリストに残ります（選択を黙って捨てないため）。`onError({ type: "upload_file" })` は非同期に、`handleAdd` が `true` を返した後で発火します。`uploadRef` を伴わずに解決した転送は失敗として扱います。

開発時の `<StrictMode>` では、React が effect を再実行する前に一度 cleanup を走らせるため、mount 時に始まった転送は中断されて再発行されます。`uploadFile` は 2 回呼ばれますが、結果を書き戻すのは 1 本だけです。`ctx.signal` を尊重すれば捨てられる側をキャンセルでき、無視した場合は孤児のオブジェクトが残るのでストレージの lifecycle rule で回収してください。

`uploads.wait()` は送信時点でフックが mount されていることを要求します。フォームレベルで呼んでいれば構造的に満たされます（画像 UI が unmount されるウィザード構成でも同じです）。

`uploadRef` を持たない `new` 項目がフォーム state に現れたら（mount 時、remount 後、初期値が非同期に届いたとき）、その転送は再発行されます。すでに失敗した転送は放置されるので `uploads.retry(tempId)` を使ってください。

## ユーティリティ (ImageUtils)

| 関数 | シグネチャ | 用途 |
|---|---|---|
| `createNew` | `(tempId, file, uploadRef?) => ImageNew` | 新規項目を作る |
| `updateNewImageFile` | `(image: ImageNew, newFile) => ImageNew` | `tempId` と差し替えの対応を保ったままファイルを差し替える |
| `replaceExisting` | `(image: ImageExisting, newFile) => { deletedImage, newImage }` | 既存画像を差し替える。**`markDelete` + `createNew` を手で並べず、これを使ってください** — `getReady()` が元画像を戻すための対応をこの関数が張ります |
| `markDelete` | `(image: ImageExisting) => ImageToBeDeleted` | 削除対象としてマークする |
| `markSaved` | `(image: ImageUploaded, { id, previewUrl, uploadedUrl }) => ImageExisting` | 登録が確定した項目を `existing` へ昇格させる |

`markSaved` はサーバへの登録が済んだ項目を昇格させ、次の保存で同じものが新規として再送されるのを防ぎます。引数の型が「転送完了済みでなければ昇格できない」ことを表現しています。

```ts
const promoted = ImageUtils.markSaved(image, {
  id: saved.id,
  previewUrl: saved.url,   // 両方とも必須。uploadRef は不透明なトークンで
  uploadedUrl: saved.url,  // ありうるので、そこから URL を導出できない
});
```

保存が項目ごとに部分成功しうる場合に効きます。1 リクエストで原子的に保存する API では途中まで登録された状態が存在しないので、出番はありません。

## オプション Props

| Prop | 型 | 説明 |
|------|-----|------|
| `processFile` | `(file: File) => Promise<File>` | ファイル追加・差し替え時に前処理（リサイズ・変換等）を行う関数 |
| `uploadFile` | `(file: File, ctx: { signal: AbortSignal; onProgress: (fraction: number) => void }) => Promise<{ uploadRef: string }>` | ファイル選択時に即アップロードする関数。項目の表示はブロックしない。`ctx.signal` は unmount / ファイル差し替えで abort される（尊重するかは任意。どちらでも結果は破棄される）。`ctx.onProgress` は 0..1 で進捗を報告する。どちらも使わないなら `(file) => ...` と書ける |
| `onError` | `(error: MultiImageError) => void` | `processFile` の失敗、`uploadFile` の失敗、`maxImages` 超過時に呼ばれるエラーハンドラ |
| `constraints` | `ImageConstraints` | バリデーション制約（`acceptedTypes` / `maxFileSize` / `maxImages`） |
| `messages` | `CoreMessages` | i18n 用メッセージカスタマイズ |

**`processFile` が返す promise は必ず settle させてください。** `uploads.wait()` はこれを await する handler の完了を待つため、解決も棄却もしない変換があると保存が返らなくなります（`uploadFile` の有無によらず）。中断のための `signal` は渡らないので、止まりうる処理にはタイムアウトを付けて棄却してください。棄却は `type: "process_file"` の `onError` として通知され、項目は元のファイルのまま残ります。

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
