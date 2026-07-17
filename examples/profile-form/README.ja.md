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
