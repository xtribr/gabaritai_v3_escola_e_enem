import { supabase } from './supabase';

/**
 * Fetch autenticado - adiciona token JWT do Supabase automaticamente
 * Use este wrapper em vez de fetch() para chamadas autenticadas à API
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();

  const headers = new Headers(options.headers);

  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Helper para POST com JSON autenticado
 */
export async function authPost<T = unknown>(
  url: string,
  data: unknown,
  options: RequestInit = {}
): Promise<T> {
  const response = await authFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    },
    body: JSON.stringify(data),
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Helper para GET autenticado
 */
export async function authGet<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await authFetch(url, {
    method: 'GET',
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Helper para PUT autenticado
 */
export async function authPut<T = unknown>(
  url: string,
  data: unknown,
  options: RequestInit = {}
): Promise<T> {
  const response = await authFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    },
    body: JSON.stringify(data),
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Helper para DELETE autenticado
 */
export async function authDelete<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await authFetch(url, {
    method: 'DELETE',
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Helper para upload de arquivo autenticado
 */
export async function authUpload(
  url: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<Response> {
  return authFetch(url, {
    method: 'POST',
    body: formData,
    ...options,
  });
}
