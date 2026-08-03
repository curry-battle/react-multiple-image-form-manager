import type { Image } from "./Image";
import type { UploadState } from "./UploadState";

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
		| "file"
		| "id"
		| "previewUrl"
		| "uploadedUrl"
		| "uploadRef"
		| "replacesTempId"
		| "status",
		ImageFieldError
	>
>;

export type ImagesError = {
	items: Array<SingleImageError | undefined>;
	root: ImageFieldError[];
};

export type ImageItem = {
	/**
	 * 表示用の画像。転送済みで form state への反映が済んでいない場合、
	 * 解決済みの uploadRef をマージして返す（真実は form state 側）
	 */
	image: Image;
	errors: SingleImageError | undefined;
	/** 転送中・失敗のときだけ値を持つ。完了は image.uploadRef から導出する */
	uploadState: UploadState | undefined;
};
