import { useMemo, useRef } from "react";
import type {
	ArrayPath,
	FieldValues,
	Path,
	UseFormReturn,
} from "react-hook-form";
import { useFieldArray, useFormState, useWatch } from "react-hook-form";
import type { ImageFieldAdapter } from "../core/ImageFieldAdapter";
import type { Image } from "../core/types/Image";
import type { FormWithImageField } from "../core/types/ImageSchemaTypes";
import { normalizeRhfErrors } from "./normalizeRhfErrors";
import type { RhfImagesError } from "./types";

function asArrayPath<TForm extends FieldValues>(
	fieldName: string,
): ArrayPath<TForm> {
	return fieldName as ArrayPath<TForm>;
}

function asPath<TForm extends FieldValues>(fieldName: string): Path<TForm> {
	return fieldName as unknown as Path<TForm>;
}

// biome-ignore lint/suspicious/noExplicitAny: react-hook-form v7.80+ exports FieldArray as a component, shadowing the internal type alias. Direct type import is no longer possible, so we cast through `any`.
function asFieldArrayItems(images: Image[]): any[] {
	return images;
}

function asImages(watched: unknown): Image[] {
	return (watched as Image[]) || [];
}

export function useRhfImageFieldAdapter<
	TFieldName extends string,
	TForm extends FormWithImageField<TFieldName>,
>(params: { form: UseFormReturn<TForm>; name: TFieldName }): ImageFieldAdapter {
	const { form, name } = params;
	const { control, trigger } = form;

	const { replace } = useFieldArray({
		control,
		name: asArrayPath<TForm>(name),
	});

	const watchedImages = asImages(
		useWatch({
			control,
			name: asPath<TForm>(name),
		}),
	);

	const { errors: formErrors } = useFormState({
		control,
		name: asPath<TForm>(name),
	});

	const rhfErrors = (formErrors as Record<string, unknown>)[
		name
	] as RhfImagesError;

	const normalizedErrors = useMemo(
		() => normalizeRhfErrors(rhfErrors),
		[rhfErrors],
	);

	// replace() は RHF を即座に更新するが、useWatch は再レンダーまで旧値を返す。
	// 同一レンダー内の連続操作で最新配列を読めるように ref で追跡する。
	const imagesRef = useRef<Image[]>(watchedImages);
	imagesRef.current = watchedImages;

	return {
		get images() {
			return imagesRef.current;
		},
		setImages(next: Image[]) {
			replace(asFieldArrayItems(next));
			imagesRef.current = next;
		},
		async validate() {
			await trigger(asPath<TForm>(name));
		},
		errors: normalizedErrors,
	};
}
