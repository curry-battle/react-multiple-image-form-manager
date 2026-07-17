import type { ImageFieldError } from "./types/ImageSchemaTypes";

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

export const normalizeErrorLeaf = (raw: unknown): ImageFieldError => {
	if (typeof raw === "string") {
		return raw.length > 0 ? { message: raw, source: raw } : { source: raw };
	}
	if (isPlainObject(raw)) {
		const message =
			typeof raw.message === "string" && raw.message.length > 0
				? raw.message
				: undefined;
		const type = typeof raw.type === "string" ? raw.type : undefined;
		const out: ImageFieldError = { source: raw };
		if (message !== undefined) out.message = message;
		if (type !== undefined) out.type = type;
		return out;
	}
	if (raw === undefined || raw === null) return { source: raw };
	return { message: String(raw), source: raw };
};
