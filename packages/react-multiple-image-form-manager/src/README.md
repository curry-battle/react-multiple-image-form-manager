# react-multiple-image-form-manager internals

## ディレクトリ構成

```
src/
├── index.ts                              # root barrel (core のみ export)
├── core/
│   ├── ImageFieldAdapter.ts              # Port interface
│   ├── useMultiImageCore.ts              # form-agnostic core hook
│   ├── imageListOps.ts                   # 純粋関数 (add/change/delete/move)
│   ├── normalizeErrorLeaf.ts             # 共有エラー正規化
│   └── types/
│       ├── Image.ts                      # Image 型 + ImageUtils
│       ├── ImageSchemaTypes.ts           # スキーマ共通型 + 中立エラーモデル
│       ├── ImageStatus.ts                # ImageFormStatus 定数
│       └── MultiImageError.ts            # エラー型
├── react-hook-form/
│   ├── index.ts                          # RHF barrel
│   ├── useRhfImageFieldAdapter.ts        # RHF → ImageFieldAdapter
│   ├── useMultiImageInputController.ts   # convenience hook (adapter + core)
│   ├── MultiImageInputController.tsx     # render-props component
│   ├── normalizeRhfErrors.ts             # RHF エラー → 中立エラー
│   └── types.ts                          # RHF 固有エラー型
├── tanstack-form/
│   ├── index.ts                          # TanStack barrel
│   ├── useTanstackImageFieldAdapter.ts   # TanStack → ImageFieldAdapter
│   ├── useTanstackMultiImageController.ts # convenience hook
│   ├── TanstackMultiImageController.tsx  # render-props component
│   └── normalizeTanstackErrors.ts        # TanStack エラー → 中立エラー
└── schemas/
    ├── zod.ts                            # Zod スキーマファクトリ
    ├── valibot.ts                        # Valibot スキーマファクトリ
    └── __testdata__/                     # 共通テストフィクスチャ
```

## アーキテクチャ

Hexagonal Architecture (Ports & Adapters) を採用:

- **Port**: `ImageFieldAdapter` — form library 非依存のインターフェース
- **Core**: `useMultiImageCore` — ビジネスロジック（adapter を通じて form を操作）
- **Adapters**: `useRhfImageFieldAdapter` / `useTanstackImageFieldAdapter` — 各 form library を Port に適合

## 画像のライフサイクル

```
(ファイル選択) → New →（DB登録後）→ Existing →（削除）→ ToBeDeleted
                  └──（削除）──→ 配列から除去
```

ToBeDeleted は配列内の元の位置にそのまま残る。
フックが返す `items` は ToBeDeleted を除外した可視アイテムのみ。`raw.watchedImages` は除外しない。

## エラーモデル

中立形式 `ImagesError = { items: (SingleImageError | undefined)[], root: ImageFieldError[] }` を使用。
各 adapter が form library 固有のエラー形状を `normalizeRhfErrors` / `normalizeTanstackErrors` で変換する。
