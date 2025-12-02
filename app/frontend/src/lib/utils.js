// DANS src/lib/utils.js

import clsx from "clsx";
import { twMerge } from "tailwind-merge";

// 🏆 CORRECTION DÉFINITIVE : Utilisez export function
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Assurez-vous qu'il n'y ait AUCUN "export default"
