import * as v from "valibot";
import {
	defaultMessages,
	type ImageSchemaOptions,
} from "../core/types/ImageSchemaTypes";
import { ImageFormStatus } from "../core/types/ImageStatus";

export function createImagesSchema(options: ImageSchemaOptions) {
	const {
		acceptedTypes,
		maxFileSize,
		maxImages,
		messages,
		idValidation,
		idMessage,
	} = options;

	const invalidTypeMsg = messages?.invalidType ?? defaultMessages.invalidType;
	const maxSizeMsg = messages?.maxSize ?? defaultMessages.maxSize;
	const maxImagesMsg = messages?.maxImages ?? defaultMessages.maxImages;

	const idSchema = idValidation
		? v.pipe(v.string(), v.check(idValidation, idMessage ?? "Invalid ID"))
		: v.string();

	const baseImageSchema = {
		tempId: v.string(),
	};

	const fileChecks: v.PipeItem<File, File, v.BaseIssue<unknown>>[] = [
		v.check(
			(file: File) => acceptedTypes.includes(file.type),
			invalidTypeMsg(acceptedTypes),
		),
	];

	if (maxFileSize !== undefined) {
		fileChecks.push(
			v.check(
				(file: File) => file.size <= maxFileSize,
				maxSizeMsg(maxFileSize),
			),
		);
	}

	const fileSchema = v.pipe(v.instance(File), ...fileChecks);

	const newImageSchema = v.object({
		...baseImageSchema,
		status: v.literal(ImageFormStatus.New),
		id: v.optional(v.undefined()),
		file: fileSchema,
		previewUrl: v.optional(v.undefined()),
		// uploadFile が返す値は URL とは限らない（登録 API に渡す不透明トークンでも
		// よい）ため URL 検証はかけない。existing 側は本物の URL なので残す
		uploadRef: v.optional(v.pipe(v.string(), v.minLength(1))),
		// スキーマから漏らすとパース時に落ちて、差し替えの対応関係が失われる
		replacesTempId: v.optional(v.pipe(v.string(), v.minLength(1))),
	});

	const existingImageSchema = v.object({
		...baseImageSchema,
		status: v.literal(ImageFormStatus.Existing),
		id: idSchema,
		file: v.optional(v.undefined()),
		previewUrl: v.pipe(v.string(), v.url()),
		uploadedUrl: v.pipe(v.string(), v.url()),
	});

	const deletedImageSchema = v.object({
		...baseImageSchema,
		status: v.literal(ImageFormStatus.ToBeDeleted),
		id: idSchema,
		file: v.optional(v.undefined()),
		previewUrl: v.pipe(v.string(), v.url()),
		uploadedUrl: v.pipe(v.string(), v.url()),
	});

	const imageUnion = v.union([
		newImageSchema,
		existingImageSchema,
		deletedImageSchema,
	]);

	if (maxImages !== undefined) {
		return v.pipe(
			v.array(imageUnion),
			v.check((images) => {
				const visibleCount = images.filter(
					(img) => img.status !== ImageFormStatus.ToBeDeleted,
				).length;
				return visibleCount <= maxImages;
			}, maxImagesMsg(maxImages)),
		);
	}

	return v.array(imageUnion);
}

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest;
	const {
		validNewImage,
		validExistingImage,
		validToBeDeletedImage,
		validMixedImages,
		invalidNewImageWithPng,
		invalidNewImageWithoutFile,
		invalidExistingWithBadId,
		invalidExistingWithoutUploadedUrl,
		invalidImageWithBadStatus,
		makeWebpFile,
		makeLargeFile,
		makeNewImageData,
		makeToBeDeletedImageData,
		makeNewImageDataArray,
	} = await import("./__testdata__/imageSchemaTestData");

	// テスト用のデフォルトスキーマ
	const imagesSchema = createImagesSchema({
		acceptedTypes: ["image/jpeg", "image/jpg"],
	});

	describe("createImagesSchema (valibot)", () => {
		describe("基本動作（acceptedTypesのみ指定）", () => {
			it("空配列を受け入れること", () => {
				expect(v.safeParse(imagesSchema, []).success).toBe(true);
			});

			it("正しいImageNew配列を受け入れること", () => {
				expect(v.safeParse(imagesSchema, [validNewImage]).success).toBe(true);
			});

			it("正しいImageExisting配列を受け入れること", () => {
				expect(v.safeParse(imagesSchema, [validExistingImage]).success).toBe(
					true,
				);
			});

			it("正しいImageToBeDeleted配列を受け入れること", () => {
				expect(v.safeParse(imagesSchema, [validToBeDeletedImage]).success).toBe(
					true,
				);
			});

			it("3種混合配列を受け入れること", () => {
				expect(v.safeParse(imagesSchema, validMixedImages).success).toBe(true);
			});
		});

		describe("異常系（基本）", () => {
			it("file.typeがimage/pngのImageNew → reject", () => {
				expect(
					v.safeParse(imagesSchema, [invalidNewImageWithPng]).success,
				).toBe(false);
			});

			it("fileが存在しないImageNew → reject", () => {
				expect(
					v.safeParse(imagesSchema, [invalidNewImageWithoutFile]).success,
				).toBe(false);
			});

			it("idが任意の文字列でもデフォルトでは受け入れること", () => {
				expect(
					v.safeParse(imagesSchema, [invalidExistingWithBadId]).success,
				).toBe(true);
			});

			it("uploadedUrlがないImageExisting → reject", () => {
				expect(
					v.safeParse(imagesSchema, [invalidExistingWithoutUploadedUrl])
						.success,
				).toBe(false);
			});

			it("不正なstatus値 → reject", () => {
				expect(
					v.safeParse(imagesSchema, [invalidImageWithBadStatus]).success,
				).toBe(false);
			});
		});

		describe("idValidation", () => {
			it("カスタムidValidationで不正なIDをrejectすること", () => {
				const isUuid = (id: string) =>
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						id,
					);
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg", "image/jpg"],
					idValidation: isUuid,
					idMessage: "ID must be a valid UUID",
				});
				expect(v.safeParse(schema, [invalidExistingWithBadId]).success).toBe(
					false,
				);
			});

			it("カスタムidValidationで正しいIDを受け入れること", () => {
				const isUuid = (id: string) =>
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						id,
					);
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg", "image/jpg"],
					idValidation: isUuid,
				});
				expect(v.safeParse(schema, [validExistingImage]).success).toBe(true);
			});
		});

		describe("acceptedTypes", () => {
			it("カスタムtypes (webp, png) でvalidなファイルを受け入れること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/webp", "image/png"],
				});
				const data = [
					makeNewImageData({ tempId: "temp_webp", file: makeWebpFile() }),
				];
				expect(v.safeParse(schema, data).success).toBe(true);
			});

			it("カスタムtypesに含まれない形式はrejectされること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/webp"],
				});
				const data = [makeNewImageData({ tempId: "temp_jpg" })];
				expect(v.safeParse(schema, data).success).toBe(false);
			});
		});

		describe("maxFileSize", () => {
			it("サイズ超過時にリジェクトされること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
					maxFileSize: 100,
				});
				const data = [
					makeNewImageData({ tempId: "temp_large", file: makeLargeFile(200) }),
				];
				expect(v.safeParse(schema, data).success).toBe(false);
			});

			it("サイズ以内なら受け入れること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
					maxFileSize: 1000,
				});
				const data = [
					makeNewImageData({
						tempId: "temp_small",
						file: new File(["small"], "small.jpg", { type: "image/jpeg" }),
					}),
				];
				expect(v.safeParse(schema, data).success).toBe(true);
			});

			it("未指定時はサイズ制限なし", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
				});
				const data = [
					makeNewImageData({
						tempId: "temp_nolimit",
						file: makeLargeFile(10000),
					}),
				];
				expect(v.safeParse(schema, data).success).toBe(true);
			});
		});

		describe("maxImages", () => {
			it("超過時にリジェクトされること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
					maxImages: 2,
				});
				expect(v.safeParse(schema, makeNewImageDataArray(3)).success).toBe(
					false,
				);
			});

			it("ToBeDeleted除外でカウントすること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
					maxImages: 2,
				});
				const data = [...makeNewImageDataArray(2), makeToBeDeletedImageData()];
				expect(v.safeParse(schema, data).success).toBe(true);
			});

			it("未指定時は枚数制限なし", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
				});
				expect(v.safeParse(schema, makeNewImageDataArray(20)).success).toBe(
					true,
				);
			});
		});

		describe("messages", () => {
			it("カスタムメッセージが適用されること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/webp"],
					maxFileSize: 100,
					messages: {
						invalidType: (types) => `Custom: only ${types.join("/")}`,
						maxSize: (bytes) => `Custom: max ${bytes}B`,
					},
				});
				const data = [makeNewImageData({ tempId: "temp_custom" })];
				const result = v.safeParse(schema, data);
				expect(result.success).toBe(false);
				if (!result.success) {
					const messages = result.issues.map((i) => i.message);
					expect(messages.some((m) => m.includes("Custom: only"))).toBe(true);
				}
			});

			it("カスタムmaxImagesメッセージが適用されること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
					maxImages: 1,
					messages: {
						maxImages: (max) => `Custom: max ${max} images`,
					},
				});
				const data = makeNewImageDataArray(2);
				const result = v.safeParse(schema, data);
				expect(result.success).toBe(false);
				if (!result.success) {
					const messages = result.issues.map((i) => i.message);
					expect(messages.some((m) => m === "Custom: max 1 images")).toBe(true);
				}
			});
		});
	});
}
