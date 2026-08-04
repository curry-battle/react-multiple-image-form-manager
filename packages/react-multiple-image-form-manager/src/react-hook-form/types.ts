import type { Image } from "../core/types/Image";

/**
 * union の全メンバーが持つキーの和。
 *
 * `keyof Image` は共通部分しか返さないため、`new` にしかない `uploadRef` のような
 * フィールドのエラーを表現できない。RHF は status で絞り込まずに項目ごとの
 * エラーを並べるので、和を取る必要がある
 */
type ImageKey = Image extends infer T
	? T extends Image
		? keyof T
		: never
	: never;

export type RhfSingleImageError = {
	[K in ImageKey]?: { message?: string; type?: string };
};

export type RhfImagesError =
	| (RhfSingleImageError[] & {
			root?: { message?: string; type?: string };
	  })
	| { message?: string; type?: string }
	| undefined;
