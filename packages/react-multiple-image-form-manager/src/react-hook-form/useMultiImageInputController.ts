import type { UseFormReturn } from "react-hook-form";
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
import { useRhfImageFieldAdapter } from "./useRhfImageFieldAdapter";

export type UseMultiImageInputControllerParams<
	TFieldName extends string,
	TForm extends FormWithImageField<TFieldName>,
> = {
	form: UseFormReturn<TForm>;
	name: TFieldName;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
};

export function useMultiImageInputController<
	TFieldName extends string,
	TForm extends FormWithImageField<TFieldName>,
>(
	params: UseMultiImageInputControllerParams<TFieldName, TForm> & {
		uploadFile: UploadFileFn;
	},
): UseMultiImageCoreUploadedReturn;
export function useMultiImageInputController<
	TFieldName extends string,
	TForm extends FormWithImageField<TFieldName>,
>(
	params: UseMultiImageInputControllerParams<TFieldName, TForm>,
): UseMultiImageCoreReturn;
export function useMultiImageInputController<
	TFieldName extends string,
	TForm extends FormWithImageField<TFieldName>,
>(
	params: UseMultiImageInputControllerParams<TFieldName, TForm>,
): UseMultiImageCoreUploadedReturn {
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

	const core = useMultiImageCore({
		adapter,
		processFile,
		uploadFile,
		onError,
		constraints,
		messages,
	});

	// uploadFile の有無は呼び出し側のオーバーロードで解決済み。実体は同じなので
	// 参照ごと通す。uploads のメンバだけ差し替えると uploads を組み直すことになり、
	// core が memo 化した参照が毎レンダー変わる
	return core as UseMultiImageCoreUploadedReturn;
}
