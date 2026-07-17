import type { Image } from "../core/types/Image";

export type RhfSingleImageError = {
	[K in keyof Image]?: { message?: string; type?: string };
};

export type RhfImagesError =
	| (RhfSingleImageError[] & {
			root?: { message?: string; type?: string };
	  })
	| { message?: string; type?: string }
	| undefined;
