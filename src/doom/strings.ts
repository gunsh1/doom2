// d_englsh.h strings, copied into a mutable table so DEHACKED/BEX text in the IWAD can replace them.
import { STR } from '../generated/strings_data';

export type StringId = keyof typeof STR;
export const T: Record<StringId, string> = { ...STR };
