import type { Image } from "./types/Image";
import type { ImagesError } from "./types/ImageSchemaTypes";

export interface ImageFieldAdapter {
	readonly images: readonly Image[];
	setImages(next: Image[]): void;
	validate(): Promise<void>;
	errors: ImagesError;
}
