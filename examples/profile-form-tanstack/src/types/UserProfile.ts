import type { Image } from "@curry-battle/react-multiple-image-form-manager";
import type { UUID } from "../libs/Uuid";

export type UserProfile = {
	id: UUID;
	name: string;
	profileImages: Image[];
};
