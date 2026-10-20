const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export class ApiError extends Error {
  /**
   * `detail` keeps the server's raw body. Contract refusals send an object
   * ({message, code, remedy}), and passing that straight to Error() stringifies
   * it to "[object Object]" — which is what the user saw before this existed.
   */
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
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
    let detail: unknown = response.statusText;
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {
      /* response had no JSON body */
    }
    const message =
      typeof detail === "object" && detail !== null && "message" in detail
        ? String((detail as { message: unknown }).message)
        : String(detail);
    throw new ApiError(response.status, message, detail);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

export const loginUrl = `${BASE}/auth/google/login`;
