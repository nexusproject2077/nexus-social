// Compression d'image côté client avant envoi.
// Redimensionne (bord max) puis ré-encode en WebP/JPEG à qualité réduite.
// Objectif : quelques dizaines de Ko, sans perte visible notable.
// Renvoie une data URL (string) directement stockable/affichable.

export async function compressImage(file, {
  maxDim = 1280,      // plus grande dimension conservée
  quality = 0.72,     // qualité de ré-encodage
  maxBytes = 200 * 1024, // cible : on baisse la qualité si dépassé
} = {}) {
  if (!file || !file.type?.startsWith("image/")) {
    throw new Error("Fichier image invalide");
  }

  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);

  // Calcule les dimensions cibles en gardant le ratio.
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) {
    if (width >= height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  // WebP si supporté (meilleure compression), sinon JPEG.
  const mime = canvasSupportsWebp(canvas) ? "image/webp" : "image/jpeg";

  let q = quality;
  let out = canvas.toDataURL(mime, q);
  // Réduit la qualité par paliers si l'image reste trop lourde.
  while (dataUrlBytes(out) > maxBytes && q > 0.35) {
    q -= 0.12;
    out = canvas.toDataURL(mime, q);
  }
  return out;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasSupportsWebp(canvas) {
  try {
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

// Taille approximative (octets) d'une data URL base64.
export function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}
