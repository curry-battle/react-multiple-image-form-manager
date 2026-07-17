import * as v from "valibot";
import { isUUID, type UUID } from "../utils/utils";

export const uuidSchema = v.pipe(
	v.string(),
	v.check((val): val is UUID => isUUID(val), "ID must be a valid UUID"),
);
