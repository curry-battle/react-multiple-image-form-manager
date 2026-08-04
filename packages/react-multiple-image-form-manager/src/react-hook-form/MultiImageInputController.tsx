import type { UseFormReturn } from "react-hook-form";
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
import { useMultiImageInputController } from "./useMultiImageInputController";

/**
 * `uploads` の送信素材（`wait` / `getReady`）は `uploadFile` の有無にかかわらず
 * 3 択の緩い型（`SubmitImage`）を返す。render コールバックの引数の型を
 * `uploadFile` の有無で分けると判別子が関数型になり、推論が不安定になるため。
 *
 * 緩い型は実行時に現れる形の上位集合なので嘘にはならないが、`uploadFile` を
 * 設定した場合に `{ file }` を受け付けない保存 API へ渡すにはキャストが要る。
 * 送信素材の型を確定させたい場合は `useMultiImageInputController` を直接使うこと
 */
export type ControllerRenderProps = {
	items: ImageItem[];
	rootErrors: ImageFieldError[];
	handleAdd: (file: File) => Promise<boolean>;
	handleFileChange: (tempId: string, file: File) => Promise<boolean>;
	handleDelete: (tempId: string) => Promise<boolean>;
	handleMove: (tempId: string, direction: "up" | "down") => Promise<boolean>;
	uploads: UploadsApi;
	raw: { watchedImages: readonly Image[] };
};

export function MultiImageInputController<
	TFieldName extends string,
	TForm extends FormWithImageField<TFieldName>,
>({
	form,
	name,
	render,
	processFile,
	uploadFile,
	onError,
	constraints,
	messages,
}: {
	form: UseFormReturn<TForm>;
	name: TFieldName;
	render: (props: ControllerRenderProps) => React.ReactNode;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
}) {
	const { items, rootErrors, handlers, uploads, raw } =
		useMultiImageInputController<TFieldName, TForm>({
			form,
			name,
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
