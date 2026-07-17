import type { ReactNode } from "react";
import type { Image, ProcessFileFn, UploadFileFn } from "../core/types/Image";
import type {
	CoreConstraints,
	CoreMessages,
	FormWithImageField,
	ImageFieldError,
	ImageWithErrors,
} from "../core/types/ImageSchemaTypes";
import type { MultiImageError } from "../core/types/MultiImageError";
import type {
	AnyTanstackFieldApi,
	AnyTanstackFormApi,
	ValidateCause,
} from "./useTanstackImageFieldAdapter";
import { useTanstackMultiImageController } from "./useTanstackMultiImageController";

export type TanstackControllerRenderProps = {
	itemsWithErrors: ImageWithErrors[];
	rootErrors: ImageFieldError[];
	handleAdd: (file: File) => Promise<boolean>;
	handleFileChange: (tempId: string, file: File) => Promise<boolean>;
	handleDelete: (tempId: string) => Promise<boolean>;
	handleMove: (tempId: string, direction: "up" | "down") => Promise<boolean>;
	raw: { watchedImages: readonly Image[] };
};

type InnerProps<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
> = {
	form: AnyTanstackFormApi<TFormData>;
	field: AnyTanstackFieldApi<TFormData, TFieldName>;
	name: TFieldName;
	validateCause?: ValidateCause;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	constraints?: CoreConstraints;
	messages?: CoreMessages;
	render: (props: TanstackControllerRenderProps) => ReactNode;
};

function TanstackMultiImageControllerInner<
	TFieldName extends string,
	TFormData extends FormWithImageField<TFieldName>,
>({
	form,
	field,
	name,
	validateCause,
	processFile,
	uploadFile,
	onError,
	constraints,
	messages,
	render,
}: InnerProps<TFieldName, TFormData>): ReactNode {
	const { itemsWithErrors, rootErrors, handlers, raw } =
		useTanstackMultiImageController<TFieldName, TFormData>({
			form,
			field,
			name,
			validateCause,
			processFile,
			uploadFile,
			onError,
			constraints,
			messages,
		});

	return render({ itemsWithErrors, rootErrors, ...handlers, raw });
}

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
 * Wraps `<form.Field mode="array">` and renders the inner component as children
 * to satisfy rules-of-hooks.
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
	// biome-ignore lint/suspicious/noExplicitAny: form.Field render children's `field` arg has long generics
	const Field = (form as any).Field;
	return (
		<Field name={name} mode="array">
			{(field: AnyTanstackFieldApi<TFormData, TFieldName>) => (
				<TanstackMultiImageControllerInner
					form={form}
					field={field}
					name={name}
					validateCause={validateCause}
					processFile={processFile}
					uploadFile={uploadFile}
					onError={onError}
					constraints={constraints}
					messages={messages}
					render={render}
				/>
			)}
		</Field>
	);
}
