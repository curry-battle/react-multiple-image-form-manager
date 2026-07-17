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
	uploadedUrl?: string;
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

export type ImageForSubmit =
	| ((ImageNew | ImageExisting) & { order: number })
	| (ImageToBeDeleted & { order?: undefined });

export type ProcessFileFn = (file: File) => Promise<File>;

export type UploadFileResult = {
	uploadedUrl: string;
};

export type UploadFileFn = (file: File) => Promise<UploadFileResult>;

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
	createNew: (tempId: string, file: File, uploadedUrl?: string): ImageNew => {
		return {
			tempId,
			id: undefined,
			status: ImageFormStatus.New,
			file,
			...(uploadedUrl !== undefined && { uploadedUrl }),
		};
	},
	// 新規作成中のファイルを差し替え（tempId を保持して作り直す）
	updateNewImageFile: (image: ImageNew, newFile: File): ImageNew =>
		ImageUtils.createNew(image.tempId, newFile),
	// 既存画像を新しいファイルで差し替え
	replaceExisting: (
		existingImage: ImageExisting,
		newFile: File,
	): { deletedImage: ImageToBeDeleted; newImage: ImageNew } => {
		const deletedImage = ImageUtils.markDelete(existingImage);
		const newImage = ImageUtils.createNew(generateTempId(), newFile);

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
	// 送信用に可視順の連番 order を付与（ToBeDeleted はスキップ）
	computeImagesForSubmit: (images: Image[]): ImageForSubmit[] => {
		let count = 0;
		return images.map((img): ImageForSubmit => {
			if (img.status === ImageFormStatus.ToBeDeleted) {
				return { ...img, order: undefined };
			}
			return { ...img, order: count++ };
		});
	},
};

if (import.meta.vitest) {
	const { describe, it, expect, expectTypeOf } = import.meta.vitest;

	// --- Test Helpers ---
	const makeNew = (overrides?: Partial<ImageNew>): ImageNew => ({
		tempId: "temp_test-new",
		status: ImageFormStatus.New,
		id: undefined,
		file: new File(["data"], "test.jpg", { type: "image/jpeg" }),
		uploadedUrl: undefined,
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

	const makeToBeDeleted = (
		overrides?: Partial<ImageToBeDeleted>,
	): ImageToBeDeleted => ({
		tempId: "temp_test-deleted",
		status: ImageFormStatus.ToBeDeleted,
		id: "00000000-0000-7000-8000-000000000002",
		previewUrl: "https://s3.example.com/deleted.jpg",
		uploadedUrl: "https://s3.example.com/deleted.jpg",
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
		describe("computeImagesForSubmit", () => {
			it("空配列 → 空配列", () => {
				expect(ImageUtils.computeImagesForSubmit([])).toEqual([]);
			});

			it("New/Existing のみ → 0, 1, 2... と連番order", () => {
				const images: Image[] = [makeNew(), makeExisting()];
				const result = ImageUtils.computeImagesForSubmit(images);
				expect(result.map((r) => r.order)).toEqual([0, 1]);
			});

			it("ToBeDeleted → order: undefined", () => {
				const images: Image[] = [makeToBeDeleted()];
				const result = ImageUtils.computeImagesForSubmit(images);
				expect(result[0]?.order).toBeUndefined();
			});

			it("混合配列: ToBeDeletedをスキップして連番", () => {
				const images: Image[] = [
					makeNew(),
					makeToBeDeleted(),
					makeExisting(),
					makeNew({ tempId: "temp_another" }),
				];
				const result = ImageUtils.computeImagesForSubmit(images);
				expect(result.map((r) => r.order)).toEqual([0, undefined, 1, 2]);
			});

			it("全てToBeDeleted → 全てundefined", () => {
				const images: Image[] = [makeToBeDeleted(), makeToBeDeleted()];
				const result = ImageUtils.computeImagesForSubmit(images);
				expect(result.every((r) => r.order === undefined)).toBe(true);
			});

			it("元配列を変更しないこと", () => {
				const images: Image[] = [makeNew(), makeExisting()];
				const original = [...images];
				ImageUtils.computeImagesForSubmit(images);
				expect(images).toEqual(original);
			});

			it("status で絞り込むと order の型が確定する（tsc が検証; test runner では no-op）", () => {
				const result = ImageUtils.computeImagesForSubmit([]);
				const item = result[0];
				if (item) {
					if (item.status === ImageFormStatus.ToBeDeleted) {
						expectTypeOf(item.order).toEqualTypeOf<undefined>();
					} else {
						expectTypeOf(item.order).toEqualTypeOf<number>();
					}
				}
			});
		});

		describe("createNew", () => {
			it("正しいImageNew構造を返すこと", () => {
				const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
				const result = ImageUtils.createNew("temp_abc", file);

				expect(result.status).toBe(ImageFormStatus.New);
				expect(result.tempId).toBe("temp_abc");
				expect(result.file).toBe(file);
				expect(result.id).toBeUndefined();
			});

			it("uploadedUrl を渡すと設定されること", () => {
				const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
				const result = ImageUtils.createNew(
					"temp_abc",
					file,
					"https://s3.example.com/photo.jpg",
				);

				expect(result.uploadedUrl).toBe("https://s3.example.com/photo.jpg");
			});

			it("uploadedUrl を省略すると uploadedUrl キーが存在しないこと", () => {
				const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
				const result = ImageUtils.createNew("temp_abc", file);

				expect("uploadedUrl" in result).toBe(false);
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
