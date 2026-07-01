import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility untuk menggabungkan class names dengan Tailwind CSS.
 * Menggunakan clsx untuk conditional classes dan tailwind-merge
 * untuk menghindari konflik utility classes.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
