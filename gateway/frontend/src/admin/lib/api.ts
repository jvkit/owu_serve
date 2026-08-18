export function getAdminToken(): string {
  try {
    return localStorage.getItem('gw_admin_token') || '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem('gw_admin_token', token);
  } catch {}
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem('gw_admin_token');
  } catch {}
}

async function request(method: string, path: string, body?: Record<string, any>) {
  const token = getAdminToken();
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

export function apiGet(path: string) {
  return request('GET', path);
}

export function apiPost(path: string, body?: Record<string, any>) {
  return request('POST', path, body);
}

export function apiPut(path: string, body?: Record<string, any>) {
  return request('PUT', path, body);
}

export function apiDelete(path: string) {
  return request('DELETE', path);
}
