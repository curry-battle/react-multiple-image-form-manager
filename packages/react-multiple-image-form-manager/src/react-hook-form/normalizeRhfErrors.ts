import { isPlainObject, normalizeErrorLeaf } from "../core/normalizeErrorLeaf";
import type {
	ImageFieldError,
	ImagesError,
	SingleImageError,
} from "../core/types/ImageSchemaTypes";
import type { RhfImagesError, RhfSingleImageError } from "./types";

const IMAGE_FIELD_KEYS = [
	"file",
	"id",
	"previewUrl",
	"uploadedUrl",
	"status",
] as const;

const normalizeItem = (
	rawItem: RhfSingleImageError | undefined,
): SingleImageError | undefined => {
	if (rawItem === undefined || rawItem === null) return undefined;
	const out: SingleImageError = {};
	let hasAny = false;
	for (const key of IMAGE_FIELD_KEYS) {
		const leaf = (rawItem as Record<string, unknown>)[key];
		if (leaf === undefined) continue;
		out[key] = normalizeErrorLeaf(leaf);
		hasAny = true;
	}
	return hasAny ? out : undefined;
};

export function normalizeRhfErrors(input: RhfImagesError): ImagesError {
	if (input === undefined || input === null) {
		return { items: [], root: [] };
	}

	const items: Array<SingleImageError | undefined> = [];
	const root: ImageFieldError[] = [];

	if (Array.isArray(input)) {
		for (let i = 0; i < input.length; i++) {
			items.push(normalizeItem(input[i]));
		}
	} else if (isPlainObject(input)) {
		if (input.message !== undefined || input.type !== undefined) {
			root.push(normalizeErrorLeaf(input));
		}
	}

	const rootMaybe = (input as unknown as Record<string, unknown>).root;
	if (rootMaybe !== undefined) {
		root.push(normalizeErrorLeaf(rootMaybe));
	}

	return { items, root };
}
