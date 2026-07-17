export const validUUID = "019415a9-7c6c-7bf0-9c0f-1a2b3c4d5e6f";
export const validHttpsUrl = "https://s3.example.com/img.jpg";

export const makeJpegFile = (name = "photo.jpg") =>
	new File(["data"], name, { type: "image/jpeg" });

export const makePngFile = (name = "photo.png") =>
	new File(["data"], name, { type: "image/png" });

export const makeWebpFile = (name = "photo.webp") =>
	new File(["data"], name, { type: "image/webp" });

export const makeLargeFile = (size: number, name = "large.jpg") =>
	new File(["x".repeat(size)], name, { type: "image/jpeg" });

// --- 正常系データ ---

export const validNewImage = {
	tempId: "temp_1",
	status: "new" as const,
	id: undefined,
	file: makeJpegFile(),
	previewUrl: undefined,
	uploadedUrl: undefined,
};

export const validExistingImage = {
	tempId: "temp_2",
	status: "existing" as const,
	id: validUUID,
	file: undefined,
	previewUrl: validHttpsUrl,
	uploadedUrl: validHttpsUrl,
};

export const validToBeDeletedImage = {
	tempId: "temp_3",
	status: "tobedeleted" as const,
	id: validUUID,
	file: undefined,
	previewUrl: validHttpsUrl,
	uploadedUrl: validHttpsUrl,
};

export const validMixedImages = [
	{
		tempId: "temp_new",
		status: "new" as const,
		id: undefined,
		file: makeJpegFile("a.jpg"),
		previewUrl: undefined,
		uploadedUrl: undefined,
	},
	{
		tempId: "temp_existing",
		status: "existing" as const,
		id: validUUID,
		file: undefined,
		previewUrl: validHttpsUrl,
		uploadedUrl: validHttpsUrl,
	},
	{
		tempId: "temp_deleted",
		status: "tobedeleted" as const,
		id: validUUID,
		file: undefined,
		previewUrl: validHttpsUrl,
		uploadedUrl: validHttpsUrl,
	},
];

// --- 異常系データ ---

export const invalidNewImageWithPng = {
	tempId: "temp_png",
	status: "new" as const,
	id: undefined,
	file: makePngFile(),
	previewUrl: undefined,
	uploadedUrl: undefined,
};

export const invalidNewImageWithoutFile = {
	tempId: "temp_nofile",
	status: "new" as const,
	id: undefined,
	previewUrl: undefined,
	uploadedUrl: undefined,
};

export const invalidExistingWithBadId = {
	tempId: "temp_bad_id",
	status: "existing" as const,
	id: "not-a-uuid",
	file: undefined,
	previewUrl: validHttpsUrl,
	uploadedUrl: validHttpsUrl,
};

export const invalidExistingWithoutUploadedUrl = {
	tempId: "temp_no_url",
	status: "existing" as const,
	id: validUUID,
	file: undefined,
	previewUrl: validHttpsUrl,
};

export const invalidImageWithBadStatus = {
	tempId: "temp_bad_status",
	status: "invalid",
	id: validUUID,
	file: undefined,
	previewUrl: validHttpsUrl,
	uploadedUrl: validHttpsUrl,
};

export const validNewImageWithUploadedUrl = {
	tempId: "temp_uploaded",
	status: "new" as const,
	id: undefined,
	file: makeJpegFile(),
	previewUrl: undefined,
	uploadedUrl: validHttpsUrl,
};

export const invalidNewImageWithBadUploadedUrl = {
	tempId: "temp_bad_url",
	status: "new" as const,
	id: undefined,
	file: makeJpegFile(),
	previewUrl: undefined,
	uploadedUrl: "not-a-url",
};

// --- builders for option-specific tests ---

export const makeNewImageData = (
	overrides: { tempId?: string; file?: File; uploadedUrl?: string } = {},
) => ({
	tempId: overrides.tempId ?? "temp_1",
	status: "new" as const,
	id: undefined,
	file: overrides.file ?? makeJpegFile(),
	previewUrl: undefined,
	uploadedUrl: overrides.uploadedUrl ?? undefined,
});

export const makeToBeDeletedImageData = (
	overrides: { tempId?: string } = {},
) => ({
	tempId: overrides.tempId ?? "temp_deleted",
	status: "tobedeleted" as const,
	id: validUUID,
	file: undefined,
	previewUrl: validHttpsUrl,
	uploadedUrl: validHttpsUrl,
});

export const makeNewImageDataArray = (count: number) =>
	Array.from({ length: count }, (_, i) =>
		makeNewImageData({ tempId: `temp_${i}`, file: makeJpegFile(`${i}.jpg`) }),
	);
