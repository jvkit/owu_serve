export function getStoredAuth() {
  try {
    return {
      email: localStorage.getItem('gw_email') || '',
      token: localStorage.getItem('gw_token') || '',
    };
  } catch {
    return { email: '', token: '' };
  }
}

export async function apiGet(path: string, params?: Record<string, string>) {
  const { email, token } = getStoredAuth();
  const query = new URLSearchParams({ email, token, ...params });
  const res = await fetch(`${path}?${query.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

export async function apiPost(path: string, body?: Record<string, any>) {
  const { email, token } = getStoredAuth();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

export async function apiDelete(path: string, params?: Record<string, string>) {
  const { email, token } = getStoredAuth();
  const query = new URLSearchParams({ email, token, ...params });
  const res = await fetch(`${path}?${query.toString()}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
