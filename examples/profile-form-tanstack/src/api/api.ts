import { generateUUIDv7, type UUID } from "../libs/Uuid";

export const API = {
	getPresignedUrl: async (
		userId: UUID,
		filename: string,
		contentType: string,
	) => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		console.log(
			`Getting presigned URL for user ${userId} and file ${filename}, contentType: ${contentType}`,
		);

		return {
			presignedUrl: "https://example.com/upload",
			imageId: generateUUIDv7(),
		};
	},

	uploadToS3: async (
		userId: UUID,
		imageId: UUID,
		file: File,
		uploadUrl: string,
	): Promise<string> => {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		console.log(`Uploading file for user ${userId}: ${file.name}`);

		try {
			console.log(`Uploading to URL: ${uploadUrl}`);
		} catch (e) {
			console.error("Error during upload:", e);
		}

		const filePath = getS3FilePath(userId, imageId, file.name);
		return `https://s3.example.com/${filePath}`;
	},

	updateUserProfile: async (
		userId: UUID,
		name: string,
		// 配列の順序が表示順。新規は uploadFile が返した参照、既存は id
		profileImages: ({ id: string } | { uploadRef: string })[],
		// 命令型 API 向け。「配列に無いものは削除」と宣言する API なら不要
		deletedImageIds: string[],
		// 保存後の画像 id。配列の順序は profileImages と対応する
	): Promise<string[]> => {
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
