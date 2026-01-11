// API URL configuration
// Para uploads grandes, usar URL direta do backend (bypassa o proxy do Vercel)
export const API_URL = import.meta.env.VITE_API_URL || '';

// Para uploads grandes, usar URL direta do backend
export const UPLOAD_URL = import.meta.env.VITE_API_URL || '';

// Para outras chamadas, pode usar o proxy (path relativo)
export const apiUrl = (path: string) => path;

// Para uploads, usar URL direta do backend
export const uploadUrl = (path: string) => `${UPLOAD_URL}${path}`;

// Re-exportar helpers autenticados
export { authFetch, authPost, authGet, authPut, authDelete, authUpload } from './authFetch';
