import type { UseFormReturn } from "react-hook-form";
import type { Image, ProcessFileFn, UploadFileFn } from "../core/types/Image";
import type {
	CoreConstraints,
	CoreMessages,
	FormWithImageField,
	ImageFieldError,
	ImageWithErrors,
} from "../core/types/ImageSchemaTypes";
import type { MultiImageError } from "../core/types/MultiImageError";
import { useMultiImageInputController } from "./useMultiImageInputController";

export type ControllerRenderProps = {
	itemsWithErrors: ImageWithErrors[];
	rootErrors: ImageFieldError[];
	handleAdd: (file: File) => Promise<boolean>;
	handleFileChange: (tempId: string, file: File) => Promise<boolean>;
	handleDelete: (tempId: string) => Promise<boolean>;
	handleMove: (tempId: string, direction: "up" | "down") => Promise<boolean>;
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
	const { itemsWithErrors, rootErrors, handlers, raw } =
		useMultiImageInputController<TFieldName, TForm>({
			form,
			name,
			processFile,
			uploadFile,
			onError,
			constraints,
			messages,
		});

	return render({ itemsWithErrors, rootErrors, ...handlers, raw });
}
