import { cookies } from "next/headers";
import type { Lang } from "./dictionaries";

/** Read the user's language preference on the server (cookie). */
export async function getLang(): Promise<Lang> {
  const c = await cookies();
  const v = c.get("cafe_lang")?.value;
  return v === "en" ? "en" : "my";
}
