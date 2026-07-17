import type { UseFormReturn } from "react-hook-form";
import type { ProcessFileFn, UploadFileFn } from "../core/types/Image";
import type {
	CoreConstraints,
	CoreMessages,
	FormWithImageField,
} from "../core/types/ImageSchemaTypes";
import type { MultiImageError } from "../core/types/MultiImageError";
import type { UseMultiImageCoreReturn } from "../core/useMultiImageCore";
import { useMultiImageCore } from "../core/useMultiImageCore";
import { useRhfImageFieldAdapter } from "./useRhfImageFieldAdapter";

export function useMultiImageInputController<
	TFieldName extends string,
	TForm extends FormWithImageField<TFieldName>,
>(params: {
	form: UseFormReturn<TForm>;
	name: TFieldName;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
}): UseMultiImageCoreReturn {
	const {
		form,
		name,
		processFile,
		uploadFile,
		onError,
		constraints,
		messages,
	} = params;

	const adapter = useRhfImageFieldAdapter<TFieldName, TForm>({ form, name });

	return useMultiImageCore({
		adapter,
		processFile,
		uploadFile,
		onError,
		constraints,
		messages,
	});
}
