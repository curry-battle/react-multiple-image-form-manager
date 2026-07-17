import type { ProcessFileFn, UploadFileFn } from "../core/types/Image";
import type {
	CoreConstraints,
	CoreMessages,
	FormWithImageField,
} from "../core/types/ImageSchemaTypes";
import type { MultiImageError } from "../core/types/MultiImageError";
import { useMultiImageCore } from "../core/useMultiImageCore";
import type {
	UseTanstackImageFieldAdapterParams,
	ValidateCause,
} from "./useTanstackImageFieldAdapter";
import { useTanstackImageFieldAdapter } from "./useTanstackImageFieldAdapter";

export type UseTanstackMultiImageControllerParams<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
> = UseTanstackImageFieldAdapterParams<TFieldName, TFormData> & {
	validateCause?: ValidateCause;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
};

/**
 * Convenience hook for TanStack Form. Call inside a React component rendered
 * as children of `<form.Field mode="array">` (rules-of-hooks).
 */
export function useTanstackMultiImageController<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
>(params: UseTanstackMultiImageControllerParams<TFieldName, TFormData>) {
	const {
		form,
		field,
		name,
		validateCause,
		processFile,
		uploadFile,
		onError,
		constraints,
		messages,
	} = params;

	const adapter = useTanstackImageFieldAdapter<TFieldName, TFormData>({
		form,
		field,
		name,
		validateCause,
	});

	const { itemsWithErrors, rootErrors, handlers, raw } = useMultiImageCore({
		adapter,
		processFile,
		uploadFile,
		onError,
		constraints,
		messages,
	});

	return { itemsWithErrors, rootErrors, handlers, raw } as const;
}
