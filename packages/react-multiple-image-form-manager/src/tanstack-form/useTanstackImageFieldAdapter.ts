import type { FieldApi, ReactFormExtendedApi } from "@tanstack/react-form";
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

// FieldApi: TParentData + TName + 21 validator slots. Official AnyFieldApi widens all.
// This alias preserves TFormData / TName for value-type safety.
export type AnyTanstackFieldApi<TFormData, TName extends string> = FieldApi<
	TFormData,
	TName,
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
	field: AnyTanstackFieldApi<TFormData, TFieldName>;
	name: TFieldName;
	validateCause?: ValidateCause;
};

const EMPTY_IMAGES: readonly Image[] = Object.freeze([]);
const EMPTY_META_ERRORS: readonly unknown[] = Object.freeze([]);

/**
 * Adapts TanStack Form to the ImageFieldAdapter port.
 *
 * Reactive subscription via useStore is required: reading directly causes
 * itemsWithErrors / rootErrors to go stale after validation.
 *
 * Call this hook inside a React component rendered as children of
 * `<form.Field mode="array">` (calling it in the render function body
 * violates rules-of-hooks).
 */
export function useTanstackImageFieldAdapter<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
>(
	params: UseTanstackImageFieldAdapterParams<TFieldName, TFormData>,
): ImageFieldAdapter {
	const { form, field, name, validateCause = "change" } = params;

	const anyField = field as any;
	const anyForm = form as any;

	const images = useStore(
		anyField.store,
		(s: { value?: Image[] }) =>
			(s.value as Image[] | undefined) ?? (EMPTY_IMAGES as Image[]),
	);

	const metaErrors = useStore(
		anyField.store,
		(s: { meta?: { errors?: unknown[] } }) =>
			s.meta?.errors ?? (EMPTY_META_ERRORS as unknown[]),
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
