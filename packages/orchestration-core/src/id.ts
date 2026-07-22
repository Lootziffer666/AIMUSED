import { v4 as uuidv4 } from "uuid";

export function createId(prefix?: string): string {
  const id = uuidv4();
  return prefix ? `${prefix}_${id}` : id;
}
