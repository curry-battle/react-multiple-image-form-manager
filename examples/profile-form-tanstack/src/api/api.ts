import type { ImageFormStatus } from "@curry-battle/react-multiple-image-form-manager";
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
		profileImages: {
			id?: string;
			status:
				| typeof ImageFormStatus.Existing
				| typeof ImageFormStatus.ToBeDeleted
				| typeof ImageFormStatus.New;
			order: number | undefined;
			uploadedUrl?: string;
		}[],
	): Promise<boolean> => {
		await new Promise((resolve) => setTimeout(resolve, 500));

		console.log("Updating user profile with data:", {
			userId,
			name,
			profileImages,
		});

		const success = true;

		return success;
	},
};

const getS3FilePath = (userId: UUID, imageId: UUID, filename: string) => {
	return `users/${userId}/profile-images/${imageId}-${filename}`;
};
