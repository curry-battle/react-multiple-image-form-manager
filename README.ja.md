# react-multiple-image-form-manager

[![CI](https://github.com/curry-battle/react-multiple-image-form-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/curry-battle/react-multiple-image-form-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

React 向けのヘッドレスな複数画像管理ライブラリ。追加・削除・並べ替え・差し替えをバリデーションとプレビューURL管理付きで提供します。

[English](./README.md)

**React Hook Form** と **TanStack Form** に対応し、**Zod** / **Valibot** スキーマ統合もサポートしています。

## 特徴

- ヘッドレス (render-prop) API — UIは自由に実装可能
- 画像の追加・削除・並べ替え・差し替えを宣言的に管理
- Discriminated Union による型安全な画像ステート (`new` / `existing` / `toBeDeleted`)
- `useImagePreviewUrl` hook による blob URL ライフサイクルの自動管理
- `processFile` コールバックでクライアント側の前処理（リサイズ・変換等）
- `uploadFile` コールバックで選択時即アップロード
- Zod & Valibot スキーマファクトリ（制約設定を共有）
- i18n 対応のエラーメッセージ

## パッケージ構成

| パッケージ | 説明 |
|-----------|------|
| [`packages/react-multiple-image-form-manager`](./packages/react-multiple-image-form-manager/) | コアライブラリ (`@curry-battle/react-multiple-image-form-manager`) |
| [`examples/profile-form`](./examples/profile-form/) | React Hook Form のサンプルアプリ |
| [`examples/profile-form-tanstack`](./examples/profile-form-tanstack/) | TanStack Form のサンプルアプリ |

## クイックスタート

```bash
pnpm install
```

### サンプルアプリの起動

```bash
# React Hook Form
pnpm run dev:example:rhf

# TanStack Form
pnpm run dev:example:tanstack
```

### ライブラリ開発

```bash
# ビルド
pnpm run build

# ユニットテスト (Vitest Browser Mode)
pnpm run test

# E2E テスト (Playwright)
pnpm run test:e2e

# 型チェック
pnpm run typecheck

# Lint & フォーマット (Biome)
pnpm run check
```

## ドキュメント

API ドキュメント・使用例・エクスポートマップは[ライブラリの README](./packages/react-multiple-image-form-manager/README.md) を参照してください。

## アーキテクチャ

**Hexagonal Architecture (Ports & Adapters)** により、画像管理ロジックの 99% をフォーム非依存に保っています。詳細は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

```
App ─┬─ react-hook-form adapter ─┐
     └─ tanstack-form adapter  ──┤
                                  └─▶ core (useMultiImageCore, imageListOps)
```

## ライセンス

[MIT](./LICENSE)
