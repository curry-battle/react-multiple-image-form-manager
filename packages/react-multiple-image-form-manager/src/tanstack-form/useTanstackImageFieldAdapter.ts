import type { ReactFormExtendedApi } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-form";
import { useMemo, useRef } from "react";
import type { ImageFieldAdapter } from "../core/ImageFieldAdapter";
import type { Image } from "../core/types/Image";
import type { FormWithImageField } from "../core/types/ImageSchemaTypes";
import { normalizeTanstackErrors } from "./normalizeTanstackErrors";

// ReactFormExtendedApi (useForm return type) carries TFormData + 11 validator/meta slots.
// Widen validator slots to any so consumers don't need to thread them through
// (same approach as TanStack's official AnyFormApi).
export type AnyTanstackFormApi<TFormData> = ReactFormExtendedApi<
	TFormData,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

export type ValidateCause = "change" | "blur" | "submit" | "server";

export type UseTanstackImageFieldAdapterParams<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
> = {
	form: AnyTanstackFormApi<TFormData>;
	name: TFieldName;
	validateCause?: ValidateCause;
};

const EMPTY_IMAGES: readonly Image[] = Object.freeze([]);
const EMPTY_META_ERRORS: readonly unknown[] = Object.freeze([]);

/**
 * Adapts TanStack Form to the ImageFieldAdapter port.
 *
 * Reactive subscription via useStore is required: reading directly causes
 * items / rootErrors to go stale after validation.
 *
 * Reads and writes go through the form store only, so this hook can be called at
 * form level. `<form.Field mode="array">` is not required: `FormApi.validateField`
 * falls back to form-level validators when no field instance is registered, and
 * `FormApi.setFieldValue` populates `fieldMeta[name]` itself, so touched / dirty /
 * per-field errors are tracked without one.
 *
 * `name` must be a top-level key of the form data; the store is read by plain key
 * access rather than a nested path.
 */
export function useTanstackImageFieldAdapter<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
>(
	params: UseTanstackImageFieldAdapterParams<TFieldName, TFormData>,
): ImageFieldAdapter {
	const { form, name, validateCause = "change" } = params;

	const anyForm = form as any;

	const images = useStore(
		anyForm.store,
		(s: { values?: Record<string, unknown> }) =>
			(s.values?.[name] as Image[] | undefined) ?? (EMPTY_IMAGES as Image[]),
	);

	const metaErrors = useStore(
		anyForm.store,
		(s: { fieldMeta?: Record<string, { errors?: unknown[] } | undefined> }) =>
			s.fieldMeta?.[name]?.errors ?? (EMPTY_META_ERRORS as unknown[]),
	);
	const errorMap = useStore(
		anyForm.store,
		(s: { errorMap?: unknown }) => s.errorMap,
	);

	const errors = useMemo(
		() =>
			normalizeTanstackErrors({
				errorMap,
				metaErrors,
				fieldName: name,
				length: images.length,
			}),
		[errorMap, metaErrors, name, images.length],
	);

	// setFieldValue 後、同一レンダー内の連続操作で最新配列を読めるように ref で追跡する。
	const imagesRef = useRef<Image[]>(images);
	imagesRef.current = images;

	return {
		get images() {
			return imagesRef.current;
		},
		setImages: (next) => {
			anyForm.setFieldValue(name, next, { dontValidate: true });
			imagesRef.current = next;
		},
		validate: async () => {
			await anyForm.validateField(name, validateCause);
		},
		errors,
	};
}
