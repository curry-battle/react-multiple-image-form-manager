export type MultiImageErrorType =
	| "max_images"
	| "process_file"
	| "upload_file"
	| "unknown";

export type MultiImageError = {
	type: MultiImageErrorType;
	message: string;
	cause?: unknown;
};
