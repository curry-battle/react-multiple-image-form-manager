import { generateUUIDv7, type UUID } from "../libs/Uuid";

export const API = {
	/**
	 * S3 Presigned URL取得API を叩く
	 */
	getPresignedUrl: async (
		userId: UUID,
		filename: string,
		contentType: string,
	) => {
		// 実際のS3 Presigned URL取得をモック
		await new Promise((resolve) => setTimeout(resolve, 500));
		console.log(
			`Getting presigned URL for user ${userId} and file ${filename}, contentType: ${contentType}`,
		);

		return {
			presignedUrl: "https://example.com/upload",
			imageId: generateUUIDv7(),
		};
	},

	/**
	 * S3アップロードAPI を叩く
	 * 実際のS3アップロードを行う
	 * 成功した場合にpublicUrlを返す
	 */
	uploadToS3: async (
		userId: UUID,
		imageId: UUID,
		file: File,
		uploadUrl: string,
	): Promise<string> => {
		// 実際のS3アップロードをモック
		await new Promise((resolve) => setTimeout(resolve, 1000));
		console.log(`Uploading file for user ${userId}: ${file.name}`);

		try {
			// POST to S3 Presigned URL
			console.log(`Uploading to URL: ${uploadUrl}`);
		} catch (e) {
			console.error("Error during upload:", e);
		}

		// 成功した場合のpublicUrlを返す
		const filePath = getS3FilePath(userId, imageId, file.name);
		return `https://s3.example.com/${filePath}`;
	},

	/**
	 * ユーザープロフィール更新API を叩く
	 * Metadataを更新する
	 */
	updateUserProfile: async (
		userId: UUID,
		name: string,
		// 配列の順序が表示順。新規は uploadFile が返した参照、既存は id
		profileImages: ({ id: string } | { uploadRef: string })[],
		// 命令型 API 向け。「配列に無いものは削除」と宣言する API なら不要
		deletedImageIds: string[],
		// 保存後の画像 id。配列の順序は profileImages と対応する
	): Promise<string[]> => {
		// ユーザープロフィール更新のモック
		await new Promise((resolve) => setTimeout(resolve, 500));

		console.log("Updating user profile with data:", {
			userId,
			name,
			profileImages,
			deletedImageIds,
		});

		// 新規画像にはサーバが id を採番する。既存はそのまま返る
		return profileImages.map((img) =>
			"id" in img ? img.id : generateUUIDv7(),
		);
	},
};

const getS3FilePath = (userId: UUID, imageId: UUID, filename: string) => {
	return `users/${userId}/profile-images/${imageId}-${filename}`;
};
