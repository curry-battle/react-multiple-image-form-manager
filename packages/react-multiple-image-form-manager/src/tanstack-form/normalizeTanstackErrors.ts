import { isPlainObject, normalizeErrorLeaf } from "../core/normalizeErrorLeaf";
import type {
	ImageFieldError,
	ImagesError,
	SingleImageError,
} from "../core/types/ImageSchemaTypes";

const IMAGE_FIELD_KEYS = [
	"file",
	"id",
	"previewUrl",
	"uploadedUrl",
	"uploadRef",
	"replacesTempId",
	"status",
] as const;

type ImageFieldKey = (typeof IMAGE_FIELD_KEYS)[number];

const IMAGE_FIELD_KEY_SET: ReadonlySet<string> = new Set(IMAGE_FIELD_KEYS);

const isImageFieldKey = (s: string): s is ImageFieldKey =>
	IMAGE_FIELD_KEY_SET.has(s);

export type NormalizeTanstackErrorsInput = {
	/**
	 * `useStore(form.store, s => s.errorMap)` value.
	 * With Standard Schema, shape is `{ onChange: Record<path, Issue[]>, ... }`.
	 */
	errorMap: unknown;
	/**
	 * `useStore(field.store, s => s.meta.errors)` value.
	 * Entries with `path: [index, fieldKey]` are routed to items; others go to root.
	 */
	metaErrors: unknown;
	/**
	 * Field name passed to `useForm` (e.g. "images").
	 */
	fieldName: string;
	/**
	 * Array length hint for pre-sizing the items array.
	 */
	length?: number;
};

/**
 * Normalize TanStack Form errorMap / metaErrors into the neutral ImagesError format.
 *
 * Walks every bucket (onChange / onBlur etc.) and recognizes keys matching
 * `${fieldName}[i].field`. Keys starting with `${fieldName}[` or `${fieldName}.`
 * that don't match the bracket pattern are preserved as root errors with source.
 * When a single key has multiple issues, last-wins for items.
 *
 * metaErrors and errorMap duplicates are de-duped by message + type.
 * Errors with neither message nor type are always preserved (no stable key to dedup).
 */
export function normalizeTanstackErrors(
	input: NormalizeTanstackErrorsInput,
): ImagesError {
	const items: Array<SingleImageError | undefined> = [];
	const root: ImageFieldError[] = [];

	if (input.length !== undefined) {
		for (let i = 0; i < input.length; i++) items.push(undefined);
	}

	const setItem = (
		index: number,
		key: ImageFieldKey,
		leaf: ImageFieldError,
	) => {
		while (items.length <= index) items.push(undefined);
		const current = items[index] ?? {};
		current[key] = leaf;
		items[index] = current;
	};

	if (Array.isArray(input.metaErrors)) {
		for (const e of input.metaErrors) {
			if (e === undefined || e === null) continue;
			if (isPlainObject(e) && Array.isArray(e.path) && e.path.length >= 2) {
				const [idx, fieldKey] = e.path;
				if (
					Number.isInteger(idx) &&
					(idx as number) >= 0 &&
					typeof fieldKey === "string" &&
					isImageFieldKey(fieldKey)
				) {
					setItem(idx as number, fieldKey, normalizeErrorLeaf(e));
					continue;
				}
			}
			root.push(normalizeErrorLeaf(e));
		}
	}

	if (isPlainObject(input.errorMap)) {
		const { fieldName } = input;
		const pattern = new RegExp(
			`^${escapeRegExp(fieldName)}\\[(\\d+)\\](?:\\.(.+))?$`,
		);

		for (const bucketKey of Object.keys(input.errorMap)) {
			const bucket = (input.errorMap as Record<string, unknown>)[bucketKey];
			if (bucket === undefined || bucket === null) continue;

			if (isPlainObject(bucket)) {
				const record = bucket as Record<string, unknown>;

				for (const pathKey of Object.keys(record)) {
					const value = record[pathKey];

					if (pathKey === fieldName) {
						const arr = Array.isArray(value) ? value : [value];
						for (const v of arr) root.push(normalizeErrorLeaf(v));
						continue;
					}

					const m = pathKey.match(pattern);
					if (!m) {
						if (
							pathKey.startsWith(`${fieldName}[`) ||
							pathKey.startsWith(`${fieldName}.`)
						) {
							const arr = Array.isArray(value) ? value : [value];
							for (const v of arr) {
								const leaf = normalizeErrorLeaf(v);
								leaf.source = { path: pathKey, value: v };
								root.push(leaf);
							}
						}
						continue;
					}

					const index = Number(m[1]);
					const rest = m[2] ?? "";

					if (rest === "") {
						const arr = Array.isArray(value) ? value : [value];
						for (const v of arr) {
							const leaf = normalizeErrorLeaf(v);
							leaf.source = {
								path: `${fieldName}[${index}]`,
								value: v,
							};
							root.push(leaf);
						}
						continue;
					}

					const dotIdx = rest.indexOf(".");
					const firstSegment = dotIdx >= 0 ? rest.substring(0, dotIdx) : rest;

					if (!isImageFieldKey(firstSegment)) {
						const arr = Array.isArray(value) ? value : [value];
						for (const v of arr) {
							const leaf = normalizeErrorLeaf(v);
							leaf.source = { path: pathKey, value: v };
							root.push(leaf);
						}
						continue;
					}

					const arr = Array.isArray(value) ? value : [value];
					for (const v of arr) {
						const leaf = normalizeErrorLeaf(v);
						if (dotIdx >= 0) {
							leaf.source = { path: rest, value: v };
						}
						setItem(index, firstSegment, leaf);
					}
				}
			} else if (typeof bucket === "string") {
				root.push(normalizeErrorLeaf(bucket));
			}
		}
	}

	// Dedup metaErrors / errorMap overlap by message + type.
	// message も type もない場合は identity dedup できないため全て保持する。
	const seen = new Set<string>();
	const dedupedRoot = root.filter((e) => {
		if (e.message === undefined && e.type === undefined) return true;
		const key = `${e.message ?? ""}\0${e.type ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	return { items, root: dedupedRoot };
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
