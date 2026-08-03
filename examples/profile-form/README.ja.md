# Form with Multiple Image Uploads Example

[English](./README.md)

React + Vite 環境で React Hook Form と Zod を使い、複数画像アップロードを取り扱うフォーム実装のサンプル。

複数画像を取り扱うユーザのプロフィールを更新するというユースケースを想定した実装をしている。

## 概要

React Hook Formの `useFieldArray` を使うと実装がぐちゃぐちゃになることが多い。という個人的な感覚がある。

例えば:
- 画像のプレビューとして表示する対象には 「S3由来のファイルのURL」, 「アップロード前にローカルで生成した `URL.createObjectUrl()` のデータ (`blob:~`)」とパターンがあってややこしい
- データをSubmitする時に、「この画像は更新しない」「削除対象を導出するためにinitalValueとFormの現在の状態を比較して……」とややこしい処理をしてしまい泥沼にハマる
- 処理とUIが密結合しすぎて、どうしようもない

など……

そこでForm内で取り回す画像を取り回す際に、Discriminated UnionやらState Machineやらを活用することで、複雑な処理の苦しみが逃れられるような実装を模索した。
ついでにControllerパターンに落とし込み、それらの処理とUIの描画を分離した。

## 前提

フォームでは「既存画像 (つまりサーバから取得した画像) の更新」「既存画像の削除」「新規画像の追加」「新規/既存含めた並び替え」をどうにかこうにか実現している。

フロントエンドからバックエンドにFileを渡さずに、フロントエンドから直接S3 PresignedURLでアップロードを行う。

バックエンドのAPIには以下が生えている想定で作っている。
多少変わってもいいと思う。

- S3 PresignedURLを取得 (取得するだけ。DBを更新しない)
- DBを更新 (S3にアップロードされたURLを含めたメタデータを永続化)

## クイックスタート

```bash
# リポジトリルートで
pnpm install

pnpm run dev:example:rhf
```

## 処理の流れ

ファイルを選んだ瞬間に S3 への転送が始まるが、**転送の完了は項目の表示をブロックしない**。保存を押した時点で未完の転送があれば、そこで待ち合わせる。

```
[ファイル選択]
  handlers.handleAdd(file)                        ProfileForm.tsx
    → items に New が入り、その場で 1 枚増える
    → 裏で uploadFile が走り出す（完了を待たない）

  handleUploadFile(file)                          ProfileForm.tsx
    → API.getPresignedUrl()                       api.ts   DB は触らない
    → API.uploadToS3()                            api.ts   S3 に直接 PUT
    → { uploadRef } を返す                                 転送先の参照

  転送が完了すると、ライブラリが該当の Image を uploadRef 付きで作り直し、
  フォームの配列ごと差し替える（元のオブジェクトは書き換えない）
    → 画面下部の「画像の状態」の JSON に uploadRef が現れる
    → 以降「転送が済んでいるか」はこの値の有無で判定できる

[保存ボタン]
  uploads.wait()                                  ProfileForm.tsx
    → 走行中の転送が全部終わるまで待つ
    → ok: false なら failedTempIds を提示して終わり
    → ok: true なら images / deletedIds が返る

  API.updateUserProfile(id, name, images, deletedIds)   api.ts
```

### 転送中に何が見えるか

| 見たいもの | どこから取るか |
|---|---|
| この画像は転送中か / 失敗したか | `items[].uploadState`（`FormMultiImageItem` へ渡す） |
| 何件走っているか | `uploads.pending.length` |
| 失敗した項目 | `uploads.failed` → `uploads.retry(tempId)` で再試行 |
| 転送の進捗 | `items[].uploadState.progress`（`uploadFile` が `ctx.onProgress` で報告した場合） |

`FormMultiImageItem` は転送中・失敗・進捗を描画するようにしてある。ただし**この例のモック API は進捗を報告しない**ため、実際に出るのは「アップロード中」だけ。パーセントも出したい場合は `handleUploadFile` の中で `ctx.onProgress(送信済み / 全体)` を呼ぶ（`XMLHttpRequest` の `upload.onprogress` などから）。

### 保存時に何が送られるか

`uploads.wait()` が返す `images` は**可視項目のみ・表示順**の配列で、各要素は次のどちらか。

```ts
{ id: "既存画像のID" }        // サーバに既にある画像
{ uploadRef: "転送先の参照" }  // 今回アップロードした画像
```

（`uploadFile` を設定しない構成では、新規画像は `{ file, tempId }` で返る）

`uploadRef` は `uploadFile` が返した値がそのまま入る。**この例では S3 の URL** だが、ライブラリ側は URL であることを前提にしていない。S3 の key だけを返す構成や、バックエンドが発行した ID（アップロード用トークンなど）を返す構成もある。表示に使える保証が無いので、プレビューは `uploadRef` ではなく `file` から描く（`useImagePreviewUrl`）。既存画像が持つ `uploadedUrl` は本物の URL なので、名前を分けてある。

`order` フィールドは無い。**配列の順序がそのまま表示順**なので、受け取る側は index を見ればよい。

削除対象は `images` に入らず `deletedIds` に分かれる。「配列に無いものは削除」と解釈する API なら `deletedIds` は無視してよい。

既存画像を差し替えた場合は「元画像の削除 + 新規追加」として扱われるので、`deletedIds` に元画像の id が入り、`images` に新しい `uploadRef` が入る。

### 保存を待たせたくない場合

`uploads.wait()` の代わりに `uploads.getReady()` を使うと、転送の完了を待たずに「いま送れるものだけ」で保存できる。同期関数で、失敗しない。

```ts
const ready = uploads.getReady();
// ready.excludedTempIds — 今回含まれなかった項目。ユーザーに伝えること
```

除外された項目はフォームに残り転送も続くので、次の保存で入る。既存画像の差し替え中でも、元画像は削除されずその位置に残るので、**元画像だけが消えることはない**。

## ディレクトリ構成

```
src/
	api/
		api.ts                  # APIの呼び出しモック
	components/
		FormMultiImageItem.tsx  # MultiImageController用の画像を表示するコンポーネント
		ProfileForm.tsx         # RHFを使うFormのルート
	types/
		UserProfile.ts          # フォームデータの型
		schemas/
			UserProfileSchema.ts    # フォームのZodスキーマ
	libs/
		Uuid/                   # UUID型に関連するUtils
```

## E2Eテスト

Playwrightを使ったE2Eテストを用意している。

```bash
# リポジトリルートで実行

# ブラウザのインストール（初回のみ）
pnpm run test:e2e:install

# テスト実行
pnpm run test:e2e

# UIモードでデバッグ
pnpm run test:e2e:ui
```

## 技術スタック

- FW: React 19
- Bundler: Vite
- Language: TypeScript
- Form: react-hook-form
- Validation: zod
- Styling: Tailwind
- Lint/Format: Biome
- E2E: Playwright
