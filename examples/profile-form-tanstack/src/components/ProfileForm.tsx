import {
	ImageFormStatus,
	ImageUtils,
	type MultiImageError,
	type MultiImageErrorType,
	type UploadFileFn,
} from "@curry-battle/react-multiple-image-form-manager";
import { useTanstackMultiImageController } from "@curry-battle/react-multiple-image-form-manager/tanstack-form";
import { useForm } from "@tanstack/react-form";
import type { ChangeEvent } from "react";
import { API } from "../api/api";
import { generateUUIDv7, type UUID } from "../libs/Uuid";
import {
	profileImageConstraints,
	type UserProfileFormType,
	userProfileSchema,
} from "../types/schemas/UserProfileSchema";
import type { UserProfile } from "../types/UserProfile";
import { FormMultiImageItem } from "./FormMultiImageItem";

interface ProfileFormProps {
	initialData?: Partial<UserProfile>;
}

export function ProfileForm({ initialData }: ProfileFormProps) {
	const form = useForm({
		defaultValues: {
			id: initialData?.id ?? generateUUIDv7(),
			name: initialData?.name ?? "",
			profileImages: initialData?.profileImages ?? [],
		} as UserProfileFormType,
		validators: { onChange: userProfileSchema },
		onSubmit: async ({ value }) => {
			await onSubmit(value);
		},
	});

	const handleImageError = (error: MultiImageError) => {
		const messages: Record<MultiImageErrorType, string> = {
			max_images: "画像の上限枚数に達しています。",
			process_file: "ファイルの処理に失敗しました。",
			upload_file: "ファイルのアップロードに失敗しました。",
			unknown: "画像の操作でエラーが発生しました。",
		};
		console.error(messages[error.type], error.cause);
	};

	const handleUploadFile: UploadFileFn = async (file) => {
		const userId = form.getFieldValue("id") as UUID;
		const { presignedUrl, imageId } = await API.getPresignedUrl(
			userId,
			file.name,
			file.type,
		);
		const uploadedImageUrl = await API.uploadToS3(
			userId,
			imageId,
			file,
			presignedUrl,
		);
		// この構成では転送先の参照が S3 の URL そのものになる。
		// S3 の key や、バックエンドが発行した ID を返す構成もある
		return { uploadRef: uploadedImageUrl };
	};

	const { items, handlers, uploads, raw } = useTanstackMultiImageController({
		form,
		name: "profileImages",
		constraints: profileImageConstraints,
		uploadFile: handleUploadFile,
		onError: handleImageError,
	});

	/**
	 * savedIds は waited.images と同じ並び（可視順）で返る。
	 * items も可視順なので index で対応づけできる
	 */
	const promoteSavedImages = (savedIds: string[]) => {
		const next = items.map(({ image }, index) => {
			if (image.status !== ImageFormStatus.New) return image;
			// wait() が ok を返した時点で new 項目は必ず uploadRef を持つ。
			// items[].image は表示用の Image なので型の上では optional のまま
			const { uploadRef } = image;
			if (uploadRef === undefined) return image;
			return ImageUtils.markSaved(
				{ ...image, uploadRef },
				{
					id: savedIds[index],
					// この構成では uploadRef が S3 の URL なので表示にも使える。
					// 登録 API がトークンを受け取る構成では、そのレスポンスの URL を渡す
					previewUrl: uploadRef,
					uploadedUrl: uploadRef,
				},
			);
		});
		form.setFieldValue("profileImages", next);
	};

	const onSubmit = async (data: UserProfileFormType) => {
		const userId = data.id as UUID;

		try {
			// 転送中でも保存は押せる。未完の転送はここで待ち合わせる
			const waited = await uploads.wait();
			if (!waited.ok) {
				console.error("アップロードに失敗した画像があります");
				return;
			}
			const savedIds = await API.updateUserProfile(
				userId,
				data.name,
				waited.images,
				waited.deletedIds,
			);
			// 登録が済んだ new 項目を existing へ昇格させる。やらないと、続けて
			// もう一度保存したときに同じ画像が新規として再送される
			promoteSavedImages(savedIds);
		} catch (error) {
			console.error("Update failed", error);
		}
	};

	return (
		<div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
			<h2 className="text-2xl font-bold mb-6">プロフィール編集</h2>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void form.handleSubmit();
				}}
				className="space-y-6"
			>
				{/* 名前入力 */}
				<form.Field name="name">
					{(field) => (
						<div>
							<label
								htmlFor="name"
								className="block text-sm font-medium text-gray-700 mb-2"
							>
								名前 <span className="text-red-500">*</span>
							</label>
							<input
								id="name"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								className="w-full px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
								placeholder="お名前を入力してください"
							/>
							{field.state.meta.errors.length > 0 && (
								<p className="mt-1 text-sm text-red-500">
									{field.state.meta.errors[0]?.message ??
										String(field.state.meta.errors[0])}
								</p>
							)}
						</div>
					)}
				</form.Field>

				{/* 画像 */}
				<div>
					<p className="block text-sm font-medium text-gray-700 mb-2">
						プロフィール画像
					</p>

					<div className="space-y-3">
						{items.map(({ image, errors, uploadState }, index) => (
							<FormMultiImageItem
								key={image.tempId}
								image={image}
								index={index}
								onChangeFile={async (e: ChangeEvent<HTMLInputElement>) => {
									const file = getFileFromChangeEvent(e);

									const tempId = e.target.dataset.tempId;
									if (!tempId)
										return console.warn("missing tempId on file input");
									handlers.handleFileChange(tempId, file);
								}}
								onDelete={handlers.handleDelete}
								onMove={handlers.handleMove}
								isFirst={index === 0}
								isLast={index === items.length - 1}
								/* 今回のスキーマではfileフィールドのエラーのみ想定している (ImageSchemaを参照) */
								error={errors?.file?.message}
								uploadState={uploadState}
								onRetry={uploads.retry}
							/>
						))}

						{items.length === 0 && (
							<div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
								画像が選択されていません
							</div>
						)}

						<div className="mb-4">
							<input
								type="file"
								accept="image/*"
								onChange={(e: ChangeEvent<HTMLInputElement>) => {
									const f = getFileFromChangeEvent(e);
									handlers.handleAdd(f);
									// 同じファイルを再選択してもonChangeが発火するようvalueをリセット
									e.target.value = "";
								}}
								className="hidden"
								id={`imageUpload-profileImages`}
							/>
							<div className="flex justify-center">
								<label
									htmlFor={`imageUpload-profileImages`}
									className="flex items-center justify-center w-12 h-12  hover:rounded-full bg-white hover:bg-blue-50 cursor-pointer"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										strokeWidth={2}
										stroke="currentColor"
										className="w-6 h-6 text-blue-600"
									>
										<title>画像追加アイコン</title>
										<circle
											cx="12"
											cy="12"
											r="11"
											stroke="currentColor"
											strokeWidth="2"
											fill="none"
										/>
										<path
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											d="M12 8v8M8 12h8"
										/>
									</svg>
								</label>
							</div>
						</div>

						<div className="mt-8">
							<p className="block text-sm font-medium text-gray-700 mb-2">
								画像の状態
							</p>
							<pre className="bg-gray-100 rounded p-4 text-xs overflow-x-auto border border-gray-300">
								{JSON.stringify(raw.watchedImages, null, 2)}
							</pre>
						</div>
					</div>
				</div>

				{/* 保存ボタン */}
				<div className="pt-4">
					<form.Subscribe
						selector={(state) => ({
							isSubmitting: state.isSubmitting,
							canSubmit: state.canSubmit,
						})}
					>
						{({ isSubmitting, canSubmit }) => (
							<button
								type="submit"
								disabled={isSubmitting || !canSubmit}
								className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
							>
								{isSubmitting ? "保存中..." : "保存"}
							</button>
						)}
					</form.Subscribe>
				</div>
			</form>
		</div>
	);
}

function getFileFromChangeEvent(event: ChangeEvent<HTMLInputElement>): File {
	const files = event.target.files;
	if (!files || files.length !== 1) throw new Error("No file selected");

	const file = files.item(0);
	if (!file) throw new Error("No file selected");

	return file;
}
