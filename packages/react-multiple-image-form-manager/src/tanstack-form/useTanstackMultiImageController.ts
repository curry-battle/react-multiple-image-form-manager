import type { ProcessFileFn, UploadFileFn } from "../core/types/Image";
import type {
	CoreConstraints,
	CoreMessages,
	FormWithImageField,
} from "../core/types/ImageSchemaTypes";
import type { MultiImageError } from "../core/types/MultiImageError";
import type {
	UseMultiImageCoreReturn,
	UseMultiImageCoreUploadedReturn,
} from "../core/useMultiImageCore";
import { useMultiImageCore } from "../core/useMultiImageCore";
import type { UseTanstackImageFieldAdapterParams } from "./useTanstackImageFieldAdapter";
import { useTanstackImageFieldAdapter } from "./useTanstackImageFieldAdapter";

export type UseTanstackMultiImageControllerParams<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
> = UseTanstackImageFieldAdapterParams<TFieldName, TFormData> & {
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
};

/**
 * Convenience hook for TanStack Form. Call it at form level so that `uploads` is
 * reachable from the submit handler.
 */
export function useTanstackMultiImageController<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
>(
	params: UseTanstackMultiImageControllerParams<TFieldName, TFormData> & {
		uploadFile: UploadFileFn;
	},
): UseMultiImageCoreUploadedReturn;
export function useTanstackMultiImageController<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
>(
	params: UseTanstackMultiImageControllerParams<TFieldName, TFormData>,
): UseMultiImageCoreReturn;
export function useTanstackMultiImageController<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
>(
	params: UseTanstackMultiImageControllerParams<TFieldName, TFormData>,
): UseMultiImageCoreUploadedReturn {
	const {
		form,
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
		name,
		validateCause,
	});

	const core = useMultiImageCore({
		adapter,
		processFile,
		uploadFile,
		onError,
		constraints,
		messages,
	});

	// uploadFile の有無は呼び出し側のオーバーロードで解決済み。実体は同じなので
	// 参照ごと通す（useMultiImageInputController と同じ理由）
	return core as UseMultiImageCoreUploadedReturn;
}
