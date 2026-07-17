import type { ImageConstraints } from "@curry-battle/react-multiple-image-form-manager";
import { createImagesSchema } from "@curry-battle/react-multiple-image-form-manager/schemas/valibot";
import * as v from "valibot";
import { isUUID } from "../../libs/Uuid";
import { uuidSchema } from "../../libs/Uuid/schemas/valibot";

export const profileImageConstraints: ImageConstraints = {
	acceptedTypes: ["image/jpeg", "image/jpg"],
};

const profileImagesSchema = createImagesSchema({
	...profileImageConstraints,
	idValidation: (id) => isUUID(id),
	idMessage: "ID must be a valid UUID",
});

export const userProfileSchema = v.object({
	id: uuidSchema,
	name: v.pipe(v.string(), v.minLength(1, "名前は必須です")),
	profileImages: profileImagesSchema,
});

export type UserProfileFormType = v.InferOutput<typeof userProfileSchema>;
