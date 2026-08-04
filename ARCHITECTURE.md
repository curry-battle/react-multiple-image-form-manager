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

- `items: ImageItem[]` — 可視画像のみ。`adapter.errors.items[originalIndex]` と `uploadState` を付与し、解決済み `uploadRef` をマージ。表示用
- `rootErrors: ImageFieldError[]` — `adapter.errors.root` をそのまま公開
- `handlers: { ... }` — add/fileChange/delete/move
- `uploads: { pending, failed, retry, wait, getReady }` — 選択時アップロードの進行状態と送信素材の取得
- `raw: { watchedImages }` — debug 用途

`uploads.wait()` / `uploads.getReady()` が返すのは送信素材そのもの。可視項目のみを表示順に
並べ、各要素は `{ id }`（既存）か `{ uploadRef }`（転送済みの新規）。`order` フィールドは持たず
配列の順序で表し、削除対象は `deletedIds` に分ける。フォーム state の union を持ち上げないので、
消費側で status ごとに詰め替え直す必要がない（`nonblocking-upload-policy.ja.md` §3.1）

`wait` は走行中の転送を待つ非同期・失敗しうる関数、`getReady` は待たない同期・失敗しない関数。
1 つの関数にオプションで畳むと「待つ、ただし待たない」という矛盾した呼び出しになる

## 選択時アップロードの非同期化

`uploadFile` を設定した場合、転送は項目の追加をブロックしない。項目を先に配列へ入れて
`file` からプレビューを描き、転送完了後に `uploadRef` を書き戻す。

転送状態はフォーム state に持たない。in-flight promise の状態は remount した瞬間に
実体を失うため、永続化される事実は `Image.uploadRef` の有無だけに限る
（blob URL を state に置かない `useImagePreviewUrl` と同じ原則）。

進捗（`ctx.onProgress`）も揮発する事実なので台帳に持ち、`items[].uploadState` から出す。
チャンクごとの報告で再レンダーが走らないよう、整数パーセントが変わったときだけ書き込む。
台帳のレコードは差し替えず別の Map に持つ。書き戻しの可否を判定している
「自分がまだ現行レコードか」の参照比較が進捗のたびに崩れるため。

書き戻しは tempId で index を再解決した上で、**転送した `File` オブジェクトとの同一性**を
比較して行う。`ImageUtils.updateNewImageFile` は tempId を保持して作り直すため、
index の再解決だけではファイル差し替えを検出できない。

`uploads.wait()` は収束ループで待つ。未開始の転送を再発行し、in-flight が 0 になるまで
待ち、フォーム state で判定する、を繰り返す。待機開始時点のスナップショットだけを await
すると、待機中に `retry` や self-heal が始めた転送が漏れる。

`uploads.getReady()` は待たず、未解決の項目を素材から抜いて `excludedTempIds` で返す。
除外した項目はフォームに残り転送も続くため、次回の保存で含まれる。

差し替えで生まれた項目を除外するときは、元画像を除外した位置へ `{ id }` として戻す。
削除を取り消すだけだと、「配列に無いものは削除」と解釈する API で元画像が消える。
対応関係は配列から復元できないため `ImageNew.replacesTempId` としてフォーム state に持つ
（フック内だと remount で失われる）。

`uploadRef` を持たない `new` 項目が現れたら転送を発行する（self-heal）。unmount で
in-flight の転送と台帳は失われるがフォーム state には項目が残るため、remount や
初期値の後差し込みでも「転送されないまま `uploads.wait` が ok を返す」状態にならない。
失敗済みの項目は自動再試行せず `uploads.retry` に委ねる。

逆方向（台帳にあるのにフォーム state に無い）も同じ effect で回収する。`form.reset` など
handlers を介さない差し替えで項目が消えると、その `failed` が `uploads.failed` に残り続け、
消費側は `items` で引けず `retry` でも消せない。判定は「一度フォーム state で見た tempId」に
限る。`ImageFieldAdapter` は `setImages` の同期反映を契約していないため、単に「今の images に
無い」で消すと追加直後の転送を反映待ちの間に中断してしまう。

### 契約違反に対する tripwire

`ImageFieldAdapter` が `File` の参照を保持しない実装だと、書き戻しが常に破棄されて
再発行が永久に回る（ライブロック）。経路が 2 つあるため tripwire も 2 系統置く。

- **reconciliation 側** — 「自分がまだ台帳の現行レコードなのに項目の `File` が
  一致しない」自己破棄を tempId ごとに数え、2 回連続で `failed` へ倒す。
  ファイル差し替えによる破棄は後続の転送にレコードを奪われているため数えない
- **`uploads.wait` 側** — 進捗の無い周回（未解決 tempId と失敗 tempId の集合が
  前周と同一）が 2 回続いたら打ち切る。1 回で打ち切ると、待機中のファイル選び直しを
  誤検知する

いずれも不可視のライブロックを可視の失敗へ変換するもので、`uploads.retry` で回復できる。

既知の違反モードでは reconciliation 側が同じ閾値で先に発火するため、`uploads.wait` 側の打ち切りに
到達する経路は今のところ見つかっていない。収束ループの停止性を reconciliation の実装に依存させない
ための防御として残している。

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
- `{ form, name }` のみを受け取る。読み書きがフォームストアで完結するため、
  `<form.Field mode="array">` の内側である必要がない（フォームレベルで呼べる）。
- Reactive subscription:
  - `useStore(form.store, s => s.values[name])` → `images`
  - `useStore(form.store, s => s.fieldMeta[name]?.errors)` → root meta errors
  - `useStore(form.store, s => s.errorMap)` → item path errors
- `setImages` は `form.setFieldValue(name, next)` に委譲。
- `validate()` は `form.validateField(name, validateCause ?? "change")`。
  field インスタンスが未登録なら TanStack 側がフォームレベルの検証へフォールバックする。
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
