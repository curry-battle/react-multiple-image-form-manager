import { ImageFormStatus } from "./ImageStatus";

// types

export type ImageBase = {
	// Form用の一時的なID. Reactでのkey用途などに使用
	tempId: string;
};

export type ImageNew = ImageBase & {
	status: typeof ImageFormStatus.New;
	id?: undefined;
	file: File;
	// blob URL は state より寿命が短いため保存せず、表示側で file から導出する
	// （理由の詳細は useImagePreviewUrl の doc を参照）
	previewUrl?: undefined;
	/**
	 * uploadFile が返した転送先の参照。URL とは限らない。
	 *
	 * 恒久ストレージへ直接置く構成では URL になるが、一時領域へ置いて登録 API に
	 * 引き渡す構成では不透明なトークンになる。表示に使える保証が無いため
	 * previewUrl とは別物として扱い、URL 検証もかけない
	 */
	uploadRef?: string;
	/**
	 * この項目が差し替えた既存画像の tempId（差し替えで生まれた項目のみ）。
	 *
	 * 既存画像の差し替えは「元画像を ToBeDeleted にする + 新規項目を足す」の 2 つに
	 * 分かれるため、対応関係が配列から復元できない。転送の完了を待たずに送信素材を
	 * 作る uploads.getReady は、この項目を除外するときに元画像の削除も取り消す必要が
	 * あり、そのためにリンクを永続させる。フック内に持つと remount で失われ、
	 * 「元画像が消えて差し替え後も入らない」状態が復活する
	 */
	replacesTempId?: string;
};

export type ImageExisting = ImageBase & {
	status: typeof ImageFormStatus.Existing;
	id: string;
	file?: undefined;
	// S3のURL
	previewUrl: string;
	uploadedUrl: string;
};

export type ImageToBeDeleted = ImageBase & {
	status: typeof ImageFormStatus.ToBeDeleted;
	id: string;
	file?: undefined;
	// S3のURL
	previewUrl: string;
	uploadedUrl: string;
};

export type Image = ImageNew | ImageExisting | ImageToBeDeleted;

/** 転送が完了し uploadRef が確定した新規画像 */
export type ImageUploaded = ImageNew & { uploadRef: string };

/**
 * 送信素材。`uploads.wait` / `uploads.getReady` が可視順の配列で返す。
 *
 * フォーム state の union をそのまま持ち上げず、送信に要る値だけを残す。
 * 表示順は配列の順序で表し、order フィールドは持たない。削除対象は配列に含めず
 * `deletedIds` へ分ける。「配列に無いものは削除」と宣言する API へはそのまま渡せ、
 * 削除を明示する API へは `deletedIds` を足せばよい。
 */
export type UploadedSubmitImage = { id: string } | { uploadRef: string };

/**
 * uploadFile を設定しない場合の送信素材。転送は消費側が行うので File を渡す。
 *
 * File 側にだけ tempId を載せる。`{ id }` や `{ uploadRef }` はそのままサーバへ
 * 送る値なので相関キーを混ぜないが、`{ file }` は消費側が必ず自分で転送するため、
 * 失敗した項目をユーザーへ指し示すキーが要る
 */
export type LocalSubmitImage = { id: string } | { file: File; tempId: string };

/**
 * `uploadFile` の有無が型で確定しない経路（render-props など）で出る送信素材。
 *
 * 実行時にはどちらか一方の形しか現れない。確定した型が要る場合はフックを直接使う
 */
export type SubmitImage = UploadedSubmitImage | LocalSubmitImage;

/**
 * 選択されたファイルを加工する（リサイズ・変換など）。加工後のファイルが項目に入る。
 *
 * **返す promise は必ず settle すること。** handleAdd / handleFileChange はこれを
 * await してから選択をフォームへ反映し、`uploads.wait` はその完了を待つため、
 * settle しないと保存が返らない（`uploadFile` 未設定でも同じ）。転送と違い中断の口が
 * 無いので、止まりうる処理はタイムアウトで棄却すること
 */
export type ProcessFileFn = (file: File) => Promise<File>;

export type UploadFileResult = {
	uploadRef: string;
};

/**
 * 転送の中断要求と進捗の報告口。
 *
 * signal はライブラリ→消費側、onProgress は消費側→ライブラリで、どちらも
 * 「チャネルを載せる。同一性は載せない」線の内側にある。転送がどの項目のものかを
 * 消費側に知らせないため、相関はライブラリ内部に閉じる。
 *
 * signal は unmount 時や同一項目のファイル差し替え時に abort される。
 * 無視しても結果は破棄されるため、実害は無駄な転送に留まる。
 */
export type UploadFileContext = {
	signal: AbortSignal;
	/**
	 * 転送の進捗を 0..1 で報告する。非有限値は無視され、範囲外の値は 0..1 に丸められる。
	 *
	 * 呼ぶ頻度に制限は無い。整数パーセントが変わらない報告は再レンダーを
	 * 起こさないため、チャンクごとに呼んで構わない。
	 * 残り時間の推定はライブラリでは行わない（進捗と経過時間から消費側が出す）
	 */
	onProgress: (fraction: number) => void;
};

/**
 * 選択されたファイルをストレージへ転送する。
 *
 * **返す promise は必ず settle すること。** `uploads.wait` は走行中の転送が
 * settle するまで待つため、`ctx.signal` を無視した上で解決も棄却もしない実装だと
 * 保存が返らなくなる。中断できないなら、せめてタイムアウトで棄却すること。
 *
 * ctx は optional にしない。ライブラリは常に渡すため、optional は signal を
 * 使う実装に無意味な `ctx?.signal` ガードを強いるだけになる。引数を使わない
 * 実装は `(file) => ...` と書けばよく、少ない引数の関数は代入可能。
 */
export type UploadFileFn = (
	file: File,
	ctx: UploadFileContext,
) => Promise<UploadFileResult>;

// functions

/**
 * Generate a unique temporary ID using crypto.randomUUID()
 * This ensures uniqueness even when multiple files are uploaded simultaneously
 */
export const generateTempId = (): string => {
	return `temp_${crypto.randomUUID()}`;
};

export const ImageUtils = {
	// 新規作成
	createNew: (tempId: string, file: File, uploadRef?: string): ImageNew => {
		return {
			tempId,
			id: undefined,
			status: ImageFormStatus.New,
			file,
			...(uploadRef !== undefined && { uploadRef }),
		};
	},
	// 新規作成中のファイルを差し替え（tempId を保持して作り直す）
	updateNewImageFile: (image: ImageNew, newFile: File): ImageNew => ({
		...ImageUtils.createNew(image.tempId, newFile),
		// 差し替えで生まれた項目のファイルをさらに選び直しても、元画像との
		// 対応は維持する
		...(image.replacesTempId !== undefined && {
			replacesTempId: image.replacesTempId,
		}),
	}),
	// 既存画像を新しいファイルで差し替え
	replaceExisting: (
		existingImage: ImageExisting,
		newFile: File,
	): { deletedImage: ImageToBeDeleted; newImage: ImageNew } => {
		const deletedImage = ImageUtils.markDelete(existingImage);
		const newImage: ImageNew = {
			...ImageUtils.createNew(generateTempId(), newFile),
			replacesTempId: existingImage.tempId,
		};

		return { deletedImage, newImage };
	},
	// 既存画像を削除対象としてマーク
	markDelete: (image: ImageExisting): ImageToBeDeleted => {
		return {
			tempId: image.tempId,
			id: image.id,
			status: ImageFormStatus.ToBeDeleted,
			previewUrl: image.previewUrl,
			uploadedUrl: image.uploadedUrl,
		};
	},
	/**
	 * 登録が確定した new 画像を existing へ昇格させる。
	 *
	 * 引数の型が「転送完了済みでなければ昇格できない」という前提を表現する。
	 * previewUrl / uploadedUrl を必須にしているのは、uploadRef が不透明トークンの
	 * 場合に URL を導出できないため。省略を許すと、表示できない値が previewUrl に
	 * 入った ImageExisting（画像が壊れて見える状態）を作れてしまう
	 */
	markSaved: (
		image: ImageUploaded,
		params: { id: string; previewUrl: string; uploadedUrl: string },
	): ImageExisting => {
		return {
			tempId: image.tempId,
			id: params.id,
			status: ImageFormStatus.Existing,
			file: undefined,
			previewUrl: params.previewUrl,
			uploadedUrl: params.uploadedUrl,
		};
	},
};

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest;

	// --- Test Helpers ---
	const makeNew = (overrides?: Partial<ImageNew>): ImageNew => ({
		tempId: "temp_test-new",
		status: ImageFormStatus.New,
		id: undefined,
		file: new File(["data"], "test.jpg", { type: "image/jpeg" }),
		uploadRef: undefined,
		...overrides,
	});

	const makeExisting = (overrides?: Partial<ImageExisting>): ImageExisting => ({
		tempId: "temp_test-existing",
		status: ImageFormStatus.Existing,
		id: "00000000-0000-7000-8000-000000000001",
		previewUrl: "https://s3.example.com/img.jpg",
		uploadedUrl: "https://s3.example.com/img.jpg",
		file: undefined,
		...overrides,
	});

	// --- Tests ---

	describe("generateTempId", () => {
		it("temp_ プレフィックスで始まること", () => {
			expect(generateTempId()).toMatch(/^temp_/);
		});

		it("呼び出すたびに異なるIDを返すこと", () => {
			const id1 = generateTempId();
			const id2 = generateTempId();
			expect(id1).not.toBe(id2);
		});
	});

	describe("ImageUtils", () => {
		describe("createNew", () => {
			it("正しいImageNew構造を返すこと", () => {
				const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
				const result = ImageUtils.createNew("temp_abc", file);

				expect(result.status).toBe(ImageFormStatus.New);
				expect(result.tempId).toBe("temp_abc");
				expect(result.file).toBe(file);
				expect(result.id).toBeUndefined();
			});

			it("uploadRef を渡すと設定されること", () => {
				const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
				const result = ImageUtils.createNew("temp_abc", file, "upload-token-1");

				expect(result.uploadRef).toBe("upload-token-1");
			});

			it("uploadRef を省略すると uploadRef キーが存在しないこと", () => {
				const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
				const result = ImageUtils.createNew("temp_abc", file);

				expect("uploadRef" in result).toBe(false);
			});
		});

		describe("updateNewImageFile", () => {
			it("新しいFileで更新されたImageNewを返すこと", () => {
				const original = makeNew();
				const newFile = new File(["new"], "new.jpg", { type: "image/jpeg" });

				const result = ImageUtils.updateNewImageFile(original, newFile);

				expect(result.file).toBe(newFile);
				expect(result.status).toBe(ImageFormStatus.New);
			});

			it("tempIdが保持されること", () => {
				const original = makeNew({ tempId: "temp_keep-me" });
				const newFile = new File(["new"], "new.jpg", { type: "image/jpeg" });

				const result = ImageUtils.updateNewImageFile(original, newFile);
				expect(result.tempId).toBe("temp_keep-me");
			});
		});

		describe("markDelete", () => {
			it("ImageExisting → ImageToBeDeleted に変換", () => {
				const existing = makeExisting();
				const result = ImageUtils.markDelete(existing);

				expect(result.status).toBe(ImageFormStatus.ToBeDeleted);
				expect(result.id).toBe(existing.id);
				expect(result.previewUrl).toBe(existing.previewUrl);
				expect(result.uploadedUrl).toBe(existing.uploadedUrl);
				expect(result.tempId).toBe(existing.tempId);
			});
		});

		describe("markSaved", () => {
			const makeUploaded = (): ImageUploaded => ({
				...makeNew({ tempId: "temp_up" }),
				uploadRef: "upload-token-1",
			});

			it("ImageUploaded → ImageExisting に昇格すること", () => {
				const result = ImageUtils.markSaved(makeUploaded(), {
					id: "id-1",
					previewUrl: "https://cdn.example.com/up.jpg",
					uploadedUrl: "https://s3.example.com/up.jpg",
				});

				expect(result.status).toBe(ImageFormStatus.Existing);
				expect(result.id).toBe("id-1");
				expect(result.tempId).toBe("temp_up");
				expect(result.file).toBeUndefined();
			});

			it("previewUrl / uploadedUrl は引数の値をそのまま使うこと", () => {
				const result = ImageUtils.markSaved(makeUploaded(), {
					id: "id-1",
					previewUrl: "https://cdn.example.com/up.jpg",
					uploadedUrl: "https://s3.example.com/up.jpg",
				});

				expect(result.previewUrl).toBe("https://cdn.example.com/up.jpg");
				expect(result.uploadedUrl).toBe("https://s3.example.com/up.jpg");
			});

			it("uploadRef は引き継がないこと（表示に使える保証が無い）", () => {
				const result = ImageUtils.markSaved(makeUploaded(), {
					id: "id-1",
					previewUrl: "https://cdn.example.com/up.jpg",
					uploadedUrl: "https://s3.example.com/up.jpg",
				});

				expect("uploadRef" in result).toBe(false);
			});
		});

		describe("replaceExisting", () => {
			it("{deletedImage, newImage} を返すこと", () => {
				const existing = makeExisting();
				const newFile = new File(["data"], "replace.jpg", {
					type: "image/jpeg",
				});

				const result = ImageUtils.replaceExisting(existing, newFile);

				expect(result.deletedImage.status).toBe(ImageFormStatus.ToBeDeleted);
				expect(result.newImage.status).toBe(ImageFormStatus.New);
				expect(result.newImage.tempId).toMatch(/^temp_/);
				expect(result.newImage.file).toBe(newFile);
			});
		});
	});
}
