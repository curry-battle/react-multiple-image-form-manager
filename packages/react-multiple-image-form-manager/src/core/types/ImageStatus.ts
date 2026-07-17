/**
 * 画像の状態
 * new:         画像追加ボタンを押してファイル選択済みの状態。DB/S3には未登録
 * existing:    DB/S3に登録済みの状態
 * tobedeleted: DB/S3に登録済みの画像が削除指定された状態
 *
 * 遷移ルール:
 * (file選択) --> new --(DB登録)--> existing --(削除)--> tobedeleted
 *                └----(削除)--> (配列から除去)
 *
 * 画面上には new / existing の画像のみが表示される。
 * existingから差し替えを行う場合は一度existingをtobedeletedにし、新たにnewを作成する。
 */

// Status
export const ImageFormStatus = {
	New: "new",
	Existing: "existing",
	ToBeDeleted: "tobedeleted",
} as const;

export type ImageFormStatus =
	(typeof ImageFormStatus)[keyof typeof ImageFormStatus];
