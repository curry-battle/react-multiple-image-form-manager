import type { Image } from "./Image";

export type CoreConstraints = {
	maxImages?: number;
};

export type ImageConstraints = CoreConstraints & {
	acceptedTypes: string[];
	maxFileSize?: number;
};

export type ImageSchemaOptions = ImageConstraints & {
	idValidation?: (id: string) => boolean;
	idMessage?: string;
	messages?: {
		invalidType?: (types: string[]) => string;
		maxSize?: (bytes: number) => string;
		maxImages?: (max: number) => string;
	};
};

export const defaultMessages = {
	invalidType: (types: string[]) =>
		`ファイル形式は ${types.join(", ")} のいずれかのみ可能です。`,
	maxSize: (bytes: number) =>
		`ファイルサイズは ${bytes / 1024 / 1024}MB以下にしてください。`,
	maxImages: (max: number) => `画像は最大${max}枚までです。`,
};

export type CoreMessages = {
	maxImages?: (max: number) => string;
	processFile?: () => string;
	uploadFile?: () => string;
};

export const defaultCoreMessages: Required<CoreMessages> = {
	maxImages: defaultMessages.maxImages,
	processFile: () => "ファイルの処理に失敗しました。",
	uploadFile: () => "ファイルのアップロードに失敗しました。",
};

export type FormWithImageField<TFieldName extends string> = {
	[K in TFieldName]: Image[];
};

export type ImageFieldError = {
	message?: string;
	type?: string;
	source?: unknown;
};

export type SingleImageError = Partial<
	Record<
		"file" | "id" | "previewUrl" | "uploadedUrl" | "status",
		ImageFieldError
	>
>;

export type ImagesError = {
	items: Array<SingleImageError | undefined>;
	root: ImageFieldError[];
};

export type ImageWithErrors = {
	image: Image;
	errors: SingleImageError | undefined;
};
