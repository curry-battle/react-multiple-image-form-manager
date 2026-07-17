import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { ImageUtils } from "../../core/types/Image";
import type { ImageSchemaOptions } from "../../core/types/ImageSchemaTypes";
import {
	invalidExistingWithBadId,
	invalidExistingWithoutUploadedUrl,
	invalidImageWithBadStatus,
	invalidNewImageWithBadUploadedUrl,
	invalidNewImageWithoutFile,
	invalidNewImageWithPng,
	makeLargeFile,
	makeNewImageData,
	makeNewImageDataArray,
	makeToBeDeletedImageData,
	validExistingImage,
	validMixedImages,
	validNewImage,
	validNewImageWithUploadedUrl,
	validToBeDeletedImage,
} from "../__testdata__/imageSchemaTestData";
import { createImagesSchema as createValibotSchema } from "../valibot";
import { createImagesSchema as createZodSchema } from "../zod";

function parseWithBoth(options: ImageSchemaOptions, data: unknown) {
	const zodSchema = createZodSchema(options);
	const valibotSchema = createValibotSchema(options);
	return {
		zod: zodSchema.safeParse(data).success,
		valibot: v.safeParse(valibotSchema, data).success,
	};
}

function expectSameResult(
	options: ImageSchemaOptions,
	data: unknown,
	expected: boolean,
) {
	const result = parseWithBoth(options, data);
	// パリティ検証と期待値の照合を1回の assertion に畳むことで、
	// 失敗時に zod/valibot どちらが逸脱したかを diff で即読できる
	expect(result).toEqual({ zod: expected, valibot: expected });
}

const defaultOptions: ImageSchemaOptions = {
	acceptedTypes: ["image/jpeg", "image/jpg"],
};

// idValidation は zod (z.string().refine) と valibot (v.pipe + v.check) で
// 実装構造が最も乖離する分岐のため、パリティ照合を明示的に行う
const isUuid = (s: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

describe("cross-parity: zod and valibot produce identical results", () => {
	const cases: [string, ImageSchemaOptions, unknown, boolean][] = [
		["empty array", defaultOptions, [], true],
		["valid new image", defaultOptions, [validNewImage], true],
		["valid existing image", defaultOptions, [validExistingImage], true],
		["valid tobedeleted image", defaultOptions, [validToBeDeletedImage], true],
		["mixed images", defaultOptions, validMixedImages, true],
		[
			"new image with valid uploadedUrl",
			defaultOptions,
			[validNewImageWithUploadedUrl],
			true,
		],
		[
			"new image with invalid uploadedUrl",
			defaultOptions,
			[invalidNewImageWithBadUploadedUrl],
			false,
		],
		["invalid png file type", defaultOptions, [invalidNewImageWithPng], false],
		[
			"missing file on new image",
			defaultOptions,
			[invalidNewImageWithoutFile],
			false,
		],
		[
			"bad id accepted without idValidation",
			defaultOptions,
			[invalidExistingWithBadId],
			true,
		],
		[
			"idValidation rejects bad id",
			{ ...defaultOptions, idValidation: isUuid },
			[invalidExistingWithBadId],
			false,
		],
		[
			"idValidation accepts good id",
			{ ...defaultOptions, idValidation: isUuid },
			[validExistingImage],
			true,
		],
		[
			"missing uploadedUrl on existing",
			defaultOptions,
			[invalidExistingWithoutUploadedUrl],
			false,
		],
		["invalid status", defaultOptions, [invalidImageWithBadStatus], false],
		[
			"maxFileSize rejects oversized",
			{ acceptedTypes: ["image/jpeg"], maxFileSize: 100 },
			[makeNewImageData({ file: makeLargeFile(200) })],
			false,
		],
		[
			// `file.size <= maxFileSize` の境界を照合する。片方が `<` にデグレしても
			// 「超過」「余裕で以内」のケースだけでは検知できないため独立に持つ
			"maxFileSize accepts size equal to limit",
			{ acceptedTypes: ["image/jpeg"], maxFileSize: 100 },
			[makeNewImageData({ file: makeLargeFile(100) })],
			true,
		],
		[
			"maxImages rejects excess",
			{ acceptedTypes: ["image/jpeg"], maxImages: 2 },
			makeNewImageDataArray(3),
			false,
		],
		[
			"maxImages excludes tobedeleted from count",
			{ acceptedTypes: ["image/jpeg"], maxImages: 2 },
			[...makeNewImageDataArray(2), makeToBeDeletedImageData()],
			true,
		],
		[
			// ImageUtils の実出力は undefined フィールドのキー自体を持たない
			// （createNew は previewUrl/uploadedUrl キーなし）。valibot は
			// 「キー欠落」と「undefined 値」を区別するため、fixture の明示的
			// undefined だけでは検知できない。実出力そのものを照合する
			"real createNew output (missing undefined keys)",
			defaultOptions,
			[
				ImageUtils.createNew(
					"temp_real_new",
					new File(["data"], "real.jpg", { type: "image/jpeg" }),
				),
			],
			true,
		],
		[
			// markDelete の実出力は file キーを持たない
			"real markDelete output (missing file key)",
			defaultOptions,
			[
				ImageUtils.markDelete({
					tempId: "temp_real_del",
					status: "existing",
					id: "id-real",
					file: undefined,
					previewUrl: "https://s3.example.com/img.jpg",
					uploadedUrl: "https://s3.example.com/img.jpg",
				}),
			],
			true,
		],
	];

	for (const [name, options, data, expected] of cases) {
		it(name, () => {
			expectSameResult(options, data, expected);
		});
	}
});
