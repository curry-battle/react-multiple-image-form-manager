import {
	ImageFormStatus,
	ImageUtils,
	type MultiImageError,
	type MultiImageErrorType,
	type UploadFileFn,
} from "@curry-battle/react-multiple-image-form-manager";
import { MultiImageInputController } from "@curry-battle/react-multiple-image-form-manager/react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import type { ChangeEvent } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { API } from "../api/api";
import type { UUID } from "../libs/Uuid";
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
	const [isUploading, setIsUploading] = useState(false);

	const form = useForm<UserProfileFormType>({
		resolver: standardSchemaResolver(userProfileSchema),
		defaultValues: {
			name: initialData?.name || "",
			profileImages: initialData?.profileImages || [],
		},
		mode: "onChange",
	});

	const { register, handleSubmit, formState } = form;

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
		const userId = form.getValues("id" as never) as unknown as UUID;
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
		return { uploadedUrl: uploadedImageUrl };
	};

	const onSubmit = async (data: UserProfileFormType) => {
		setIsUploading(true);

		try {
			const imagesForSubmit = ImageUtils.computeImagesForSubmit(
				data.profileImages,
			);
			const hasUnfinishedUploads = imagesForSubmit.some(
				(img) => img.status === ImageFormStatus.New && !img.uploadedUrl,
			);
			if (hasUnfinishedUploads) {
				console.error("アップロードが完了していない画像があります");
				setIsUploading(false);
				return;
			}
			await API.updateUserProfile(
				data.id,
				data.name,
				imagesForSubmit.map((img) => {
					const base = {
						id: img.id,
						status: img.status,
						order: img.order,
					};
					if (img.status === ImageFormStatus.New) {
						return { ...base, uploadedUrl: img.uploadedUrl };
					}
					return base;
				}),
			);
		} catch (error) {
			console.error("Update failed", error);
		}

		setIsUploading(false);
	};

	return (
		<div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
			<h2 className="text-2xl font-bold mb-6">プロフィール編集</h2>

			<form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
				{/* 名前入力 */}
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
						{...register("name")}
						className="w-full px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
						placeholder="お名前を入力してください"
					/>
					{formState.errors.name && (
						<p className="mt-1 text-sm text-red-500">
							{formState.errors.name.message}
						</p>
					)}
				</div>

				{/* 画像 */}
				<MultiImageInputController
					form={form}
					name="profileImages"
					constraints={profileImageConstraints}
					uploadFile={handleUploadFile}
					onError={handleImageError}
					render={({
						itemsWithErrors,
						handleAdd,
						handleFileChange,
						handleDelete,
						handleMove,
						raw,
					}) => {
						return (
							<div>
								<p className="block text-sm font-medium text-gray-700 mb-2">
									プロフィール画像
								</p>

								<div className="space-y-3">
									{itemsWithErrors.map((itemWithErrors, index) => {
										const { image, errors } = itemWithErrors;

										// 今回のスキーマではfileフィールドのエラーのみ想定している (ImageSchemaを参照)
										const error = errors?.file?.message;

										return (
											<FormMultiImageItem
												key={image.tempId}
												image={image}
												index={index}
												onChangeFile={async (
													e: ChangeEvent<HTMLInputElement>,
												) => {
													const file = getFileFromChangeEvent(e);

													const tempId = e.target.dataset.tempId;
													if (!tempId)
														return console.warn("missing tempId on file input");
													handleFileChange(tempId, file);
												}}
												onDelete={handleDelete}
												onMove={handleMove}
												isFirst={index === 0}
												isLast={index === itemsWithErrors.length - 1}
												error={error}
											/>
										);
									})}

									{itemsWithErrors.length === 0 && (
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
												handleAdd(f);
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
						);
					}}
				/>

				{/* 保存ボタン */}
				<div className="pt-4">
					<button
						type="submit"
						disabled={isUploading || !formState.isValid}
						className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
					>
						{isUploading ? "保存中..." : "保存"}
					</button>
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
