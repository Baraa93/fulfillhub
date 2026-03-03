const API_BASE = "/api/admin";

let token: string | null = localStorage.getItem("fh_token");

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("fh_token", t);
  else localStorage.removeItem("fh_token");
}

export function getToken() {
  return token || localStorage.getItem("fh_token");
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const t = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (t) headers["Authorization"] = `Bearer ${t}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    setToken(null);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || data.message || `API error ${res.status}`);
  }

  return data as T;
}
