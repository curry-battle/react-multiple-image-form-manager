import { useEffect, useLayoutEffect, useState } from "react";
import type { Image } from "./types/Image";
import { ImageFormStatus } from "./types/ImageStatus";

// SSR では useLayoutEffect が警告を出すため useEffect にフォールバックする。
// サーバーレンダリングで object URL を生成することはないので挙動差はない
const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Image の表示用プレビューURLを導出する。
 *
 * New は file から object URL を生成して返し、Existing / ToBeDeleted は
 * state 上のサーバURL (previewUrl) をそのまま返す。
 *
 * blob URL をフォーム state に保存すると、生成元コンポーネントの unmount
 * （ウィザードのステップ移動やタブ切替）後も文字列だけが state に残り、
 * remount 時に死んだ URL を参照してしまう。生成と revoke を本フックの
 * effect cleanup に閉じ込めることで、blob URL の寿命を「このフックを呼ぶ
 * コンポーネントの表示期間」に一致させる。
 *
 * 生成には layout effect を使う。paint 前に同期的に state 更新まで済むため、
 * New 画像の mount / file 差し替え時に src 未設定のフレームが描画されない。
 *
 * リストを map で描画する場合は項目ごとの子コンポーネント内で呼ぶこと
 * （Rules of Hooks により、map コールバック内では呼べない）。
 */
export function useImagePreviewUrl(image: Image): string | undefined {
	const file = image.status === ImageFormStatus.New ? image.file : undefined;

	const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);

	useIsomorphicLayoutEffect(() => {
		if (!file) {
			setObjectUrl(undefined);
			return;
		}
		const url = URL.createObjectURL(file);
		setObjectUrl(url);
		return () => {
			URL.revokeObjectURL(url);
		};
	}, [file]);

	return image.status === ImageFormStatus.New ? objectUrl : image.previewUrl;
}
