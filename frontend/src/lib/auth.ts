const TOKEN_KEY = "deer-flow-token";
const USER_KEY = "deer-flow-user";
export const AUTH_HINT_COOKIE_KEY = "deer-flow-auth";
const AUTH_HINT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function setAuthHintCookie(enabled: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = enabled
    ? `${AUTH_HINT_COOKIE_KEY}=1; path=/; max-age=${AUTH_HINT_COOKIE_MAX_AGE}; SameSite=Lax`
    : `${AUTH_HINT_COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
}

export interface User {
  id: number;
  username: string;
  email: string;
  role: "admin" | "user";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    clearAuth();
    return null;
  }
}

export function setAuth(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  setAuthHintCookie(true);
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  setAuthHintCookie(false);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function isAdmin(): boolean {
  const user = getUser();
  return user?.role === "admin";
}

const API_BASE = "/api/auth";
const AUTH_REQUEST_TIMEOUT_MS = 6000;

async function authFetch(url: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeoutController = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => timeoutController.abort(),
    AUTH_REQUEST_TIMEOUT_MS,
  );

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal ?? timeoutController.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail ?? `请求失败 (${res.status})`);
    }
    return res.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求超时，请确认 DeerFlow 服务已启动");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function login(username: string, password: string) {
  const data = await authFetch(`${API_BASE}/login`, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setAuth(data.access_token, data.user);
  return data;
}

export async function register(
  username: string,
  email: string,
  password: string,
) {
  const data = await authFetch(`${API_BASE}/register`, {
    method: "POST",
    body: JSON.stringify({ username, email, password }),
  });
  setAuth(data.access_token, data.user);
  return data;
}

export async function fetchMe() {
  return authFetch(`${API_BASE}/me`);
}

export async function fetchAllUsers() {
  return authFetch(`${API_BASE}/admin/users`);
}

export async function updateUserStatus(userId: number, isActive: boolean) {
  return authFetch(`${API_BASE}/admin/users/${userId}/status`, {
    method: "PUT",
    body: JSON.stringify({ is_active: isActive }),
  });
}

export async function updateUserRole(userId: number, role: string) {
  return authFetch(`${API_BASE}/admin/users/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

export async function deleteUserById(userId: number) {
  return authFetch(`${API_BASE}/admin/users/${userId}`, { method: "DELETE" });
}

export function logout() {
  clearAuth();
  window.location.href = "/login";
}
