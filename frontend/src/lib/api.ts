const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Every request carries the session cookie; nothing is authenticated client-side. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(response.status, detail);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

export const loginUrl = `${BASE}/auth/google/login`;
