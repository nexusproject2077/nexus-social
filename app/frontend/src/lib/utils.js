// DANS src/lib/utils.js

import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// 💥 CHANGEMENT CLÉ : Exportation par défaut
export default cn;
