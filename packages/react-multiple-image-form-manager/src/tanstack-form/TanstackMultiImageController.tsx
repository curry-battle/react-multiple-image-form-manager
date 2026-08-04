import type { ReactNode } from "react";
import type { Image, ProcessFileFn, UploadFileFn } from "../core/types/Image";
import type {
	CoreConstraints,
	CoreMessages,
	FormWithImageField,
	ImageFieldError,
	ImageItem,
} from "../core/types/ImageSchemaTypes";
import type { MultiImageError } from "../core/types/MultiImageError";
import type { UploadsApi } from "../core/useMultiImageCore";
import type {
	AnyTanstackFormApi,
	ValidateCause,
} from "./useTanstackImageFieldAdapter";
import { useTanstackMultiImageController } from "./useTanstackMultiImageController";

/**
 * `uploads` の送信素材は `uploadFile` の有無にかかわらず緩い型を返す
 * （理由は MultiImageInputController の ControllerRenderProps を参照）。
 * 送信素材の型を確定させたい場合は `useTanstackMultiImageController` を直接使うこと
 */
export type TanstackControllerRenderProps = {
	items: ImageItem[];
	rootErrors: ImageFieldError[];
	handleAdd: (file: File) => Promise<boolean>;
	handleFileChange: (tempId: string, file: File) => Promise<boolean>;
	handleDelete: (tempId: string) => Promise<boolean>;
	handleMove: (tempId: string, direction: "up" | "down") => Promise<boolean>;
	uploads: UploadsApi;
	raw: { watchedImages: readonly Image[] };
};

export type TanstackMultiImageControllerProps<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
> = {
	/** useForm return value */
	form: AnyTanstackFormApi<TFormData>;
	/** Field name for the Image[] array */
	name: TFieldName;
	validateCause?: ValidateCause;
	render: (props: TanstackControllerRenderProps) => ReactNode;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
};

/**
 * Render-props component for TanStack Form.
 *
 * Sugar over `useTanstackMultiImageController`. The hook reads and writes through
 * the form store, so it can be called at form level; prefer it when the submit
 * handler needs `uploads` (this component keeps it inside the render callback).
 */
export function TanstackMultiImageController<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
>({
	form,
	name,
	validateCause,
	render,
	processFile,
	uploadFile,
	onError,
	constraints,
	messages,
}: TanstackMultiImageControllerProps<TFieldName, TFormData>): ReactNode {
	const { items, rootErrors, handlers, uploads, raw } =
		useTanstackMultiImageController<TFieldName, TFormData>({
			form,
			name,
			validateCause,
			processFile,
			uploadFile,
			onError,
			constraints,
			messages,
		});

	return render({
		items,
		rootErrors,
		...handlers,
		uploads,
		raw,
	});
}
