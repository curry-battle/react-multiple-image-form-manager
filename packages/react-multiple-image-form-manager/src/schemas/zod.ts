import z from "zod";
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
		? z.string().refine(idValidation, { message: idMessage ?? "Invalid ID" })
		: z.string();

	const baseImageSchema = {
		tempId: z.string(),
	};

	let fileSchema = z
		.instanceof(File)
		.refine((file) => acceptedTypes.includes(file.type), {
			message: invalidTypeMsg(acceptedTypes),
		});

	if (maxFileSize !== undefined) {
		fileSchema = fileSchema.refine((file) => file.size <= maxFileSize, {
			message: maxSizeMsg(maxFileSize),
		});
	}

	const newImageSchema = z.object({
		...baseImageSchema,
		status: z.literal(ImageFormStatus.New),
		id: z.undefined(),
		file: fileSchema,
		previewUrl: z.undefined(),
		uploadedUrl: z.url().optional(),
	});

	const existingImageSchema = z.object({
		...baseImageSchema,
		status: z.literal(ImageFormStatus.Existing),
		id: idSchema,
		file: z.undefined(),
		previewUrl: z.url(),
		uploadedUrl: z.url(),
	});

	const deletedImageSchema = z.object({
		...baseImageSchema,
		status: z.literal(ImageFormStatus.ToBeDeleted),
		id: idSchema,
		file: z.undefined(),
		previewUrl: z.url(),
		uploadedUrl: z.url(),
	});

	const imageUnion = z.union([
		newImageSchema,
		existingImageSchema,
		deletedImageSchema,
	]);

	let arraySchema = z.array(imageUnion);

	if (maxImages !== undefined) {
		arraySchema = arraySchema.refine(
			(images) => {
				const visibleCount = images.filter(
					(img) => img.status !== ImageFormStatus.ToBeDeleted,
				).length;
				return visibleCount <= maxImages;
			},
			{ message: maxImagesMsg(maxImages) },
		) as unknown as typeof arraySchema;
	}

	return arraySchema;
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

	describe("createImagesSchema (zod)", () => {
		describe("基本動作（acceptedTypesのみ指定）", () => {
			it("空配列を受け入れること", () => {
				expect(imagesSchema.safeParse([]).success).toBe(true);
			});

			it("正しいImageNew配列を受け入れること", () => {
				expect(imagesSchema.safeParse([validNewImage]).success).toBe(true);
			});

			it("正しいImageExisting配列を受け入れること", () => {
				expect(imagesSchema.safeParse([validExistingImage]).success).toBe(true);
			});

			it("正しいImageToBeDeleted配列を受け入れること", () => {
				expect(imagesSchema.safeParse([validToBeDeletedImage]).success).toBe(
					true,
				);
			});

			it("3種混合配列を受け入れること", () => {
				expect(imagesSchema.safeParse(validMixedImages).success).toBe(true);
			});
		});

		describe("異常系（基本）", () => {
			it("file.typeがimage/pngのImageNew → reject", () => {
				expect(imagesSchema.safeParse([invalidNewImageWithPng]).success).toBe(
					false,
				);
			});

			it("fileが存在しないImageNew → reject", () => {
				expect(
					imagesSchema.safeParse([invalidNewImageWithoutFile]).success,
				).toBe(false);
			});

			it("idが任意の文字列でもデフォルトでは受け入れること", () => {
				expect(imagesSchema.safeParse([invalidExistingWithBadId]).success).toBe(
					true,
				);
			});

			it("uploadedUrlがないImageExisting → reject", () => {
				expect(
					imagesSchema.safeParse([invalidExistingWithoutUploadedUrl]).success,
				).toBe(false);
			});

			it("不正なstatus値 → reject", () => {
				expect(
					imagesSchema.safeParse([invalidImageWithBadStatus]).success,
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
				expect(schema.safeParse([invalidExistingWithBadId]).success).toBe(
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
				expect(schema.safeParse([validExistingImage]).success).toBe(true);
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
				expect(schema.safeParse(data).success).toBe(true);
			});

			it("カスタムtypesに含まれない形式はrejectされること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/webp"],
				});
				const data = [makeNewImageData({ tempId: "temp_jpg" })];
				expect(schema.safeParse(data).success).toBe(false);
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
				expect(schema.safeParse(data).success).toBe(false);
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
				expect(schema.safeParse(data).success).toBe(true);
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
				expect(schema.safeParse(data).success).toBe(true);
			});
		});

		describe("maxImages", () => {
			it("超過時にリジェクトされること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
					maxImages: 2,
				});
				expect(schema.safeParse(makeNewImageDataArray(3)).success).toBe(false);
			});

			it("ToBeDeleted除外でカウントすること", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
					maxImages: 2,
				});
				const data = [...makeNewImageDataArray(2), makeToBeDeletedImageData()];
				expect(schema.safeParse(data).success).toBe(true);
			});

			it("未指定時は枚数制限なし", () => {
				const schema = createImagesSchema({
					acceptedTypes: ["image/jpeg"],
				});
				expect(schema.safeParse(makeNewImageDataArray(20)).success).toBe(true);
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
				const result = schema.safeParse(data);
				expect(result.success).toBe(false);
				if (!result.success) {
					const messages = result.error.issues.map((i) => i.message);
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
				const result = schema.safeParse(data);
				expect(result.success).toBe(false);
				if (!result.success) {
					const messages = result.error.issues.map((i) => i.message);
					expect(messages.some((m) => m === "Custom: max 1 images")).toBe(true);
				}
			});
		});
	});
}
