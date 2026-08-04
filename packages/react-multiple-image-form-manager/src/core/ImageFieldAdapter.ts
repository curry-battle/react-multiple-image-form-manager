import type { Image } from "./types/Image";
import type { ImagesError } from "./types/ImageSchemaTypes";

/**
 * フォームライブラリとの境界。実装は次の不変条件を満たすこと。
 *
 * **File の参照を保持すること。** `setImages` に渡された `Image` が持つ `File`
 * オブジェクトを、clone や再構築で別の参照に置き換えてはならない。
 * 選択時アップロードは転送結果の新旧を `File` の参照同一性で判定しており、
 * 参照が失われると書き戻しが常に破棄され、転送が繰り返し再発行される。
 * `useImagePreviewUrl` も `file` を effect の依存に取るため、参照が毎レンダー
 * 変わると object URL の生成と revoke が繰り返される。
 *
 * **`images` は read 間で参照安定であること。** read のたびに新しい配列や
 * 新しい `File` を作って返してはならない。理由は上と同じ。
 *
 * **`setImages` の結果は、次に `images` を読む時点で見えていること**（read-your-writes）。
 * 転送の待ち合わせと送信素材の生成は `images` をそのまま読むため、追加直後の項目が
 * 見えない実装では、その項目の転送を待たないまま送信素材が確定する。
 *
 * レンダーを跨ぐ非同期反映をコアが吸収しているのは `uploadRef` の解決だけ
 * （書き戻し済みだがフォーム state への反映が次のレンダーまで遅れている隙間を、
 * 台帳で埋める）。項目の増減までは吸収していない。
 */
export interface ImageFieldAdapter {
	readonly images: readonly Image[];
	setImages(next: Image[]): void;
	validate(): Promise<void>;
	errors: ImagesError;
}
