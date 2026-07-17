import type { ImageConstraints } from "@curry-battle/react-multiple-image-form-manager";
import { createImagesSchema } from "@curry-battle/react-multiple-image-form-manager/schemas/zod";
import { z } from "zod";
import { isUUID } from "../../libs/Uuid";
import { uuidSchema } from "../../libs/Uuid/schemas/zod";

export const profileImageConstraints: ImageConstraints = {
	acceptedTypes: ["image/jpeg", "image/jpg"],
};

const profileImagesSchema = createImagesSchema({
	...profileImageConstraints,
	idValidation: (id) => isUUID(id),
	idMessage: "ID must be a valid UUID",
});

export const userProfileSchema = z.object({
	id: uuidSchema,
	name: z.string().min(1, { message: "名前は必須です" }),
	profileImages: profileImagesSchema,
});

export type UserProfileFormType = z.infer<typeof userProfileSchema>;
