import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import type { Image, UploadFileFn } from "../../core/types/Image";
import type { ImageConstraints } from "../../core/types/ImageSchemaTypes";
import type { MultiImageError } from "../../core/types/MultiImageError";
import { useMultiImageInputController } from "../useMultiImageInputController";

type HarnessForm = { images: Image[] };

type HarnessOptions = {
	defaultImages?: Image[];
	constraints?: ImageConstraints;
	processFile?: (file: File) => Promise<File>;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiImageError) => void;
	resolver?: Resolver<HarnessForm>;
};

export function useHarness(options: HarnessOptions = {}) {
	const form = useForm<HarnessForm>({
		defaultValues: { images: options.defaultImages ?? [] },
		resolver: options.resolver,
	});

	const controller = useMultiImageInputController<"images", HarnessForm>({
		form,
		name: "images",
		processFile: options.processFile,
		uploadFile: options.uploadFile,
		onError: options.onError,
		constraints: options.constraints,
	});

	return { form, controller };
}

export const makeFile = (name = "a.jpg") =>
	new File(["data"], name, { type: "image/jpeg" });

export const makeExisting = (tempId: string, id: string): Image => ({
	tempId,
	status: "existing",
	id,
	file: undefined,
	previewUrl: "https://s3.example.com/img.jpg",
	uploadedUrl: "https://s3.example.com/img.jpg",
});
