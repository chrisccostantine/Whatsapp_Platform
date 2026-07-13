import axios from "axios";
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1", withCredentials: true });
let accessToken: string | null = localStorage.getItem("scalora_access_token");
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => { accessToken = token; token ? localStorage.setItem("scalora_access_token", token) : localStorage.removeItem("scalora_access_token"); };
api.interceptors.request.use((config) => { if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`; return config; });
api.interceptors.response.use(undefined, async (error) => {
  const original = error.config as { _retry?: boolean; url?: string; headers: Record<string, string> };
  if (error.response?.status === 401 && !original._retry && !original.url?.includes("/auth/")) {
    original._retry = true;
    try { const response = await api.post("/auth/refresh"); setAccessToken(response.data.data.accessToken); original.headers.Authorization = `Bearer ${response.data.data.accessToken}`; return api(original); } catch { setAccessToken(null); window.location.href = "/login"; }
  }
  return Promise.reject(error);
});
