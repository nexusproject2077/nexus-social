import axios from "axios";
import { API } from "@/App";

export const isFirebaseConfigured = true;

export async function uploadVideoResumable(file, userId, onProgress) {
  const { data: sign } = await axios.post(`${API}/media/sign`);
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sign.api_key);
  form.append("timestamp", String(sign.timestamp));
  form.append("folder", sign.folder);
  form.append("signature", sign.signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(sign.cloud_name)}/video/upload`;
  const response = await axios.post(endpoint, form, {
    onUploadProgress: (evt) => {
      if (onProgress && evt.total) onProgress(Math.round((evt.loaded * 100) / evt.total));
    },
  });
  if (!response.data?.secure_url) throw new Error("Cloudinary upload failed");
  return response.data.secure_url;
}
