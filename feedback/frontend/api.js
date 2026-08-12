const API_BASE = '/api/v1/feedback';

let externalToken = '';

export function setToken(token) {
	externalToken = token || '';
}

function getCookie(name) {
	const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
	return match ? decodeURIComponent(match[2]) : '';
}

function getToken() {
	return externalToken || getCookie('token');
}

async function request(path, options = {}) {
	const token = getToken();
	const headers = {
		Accept: 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {}),
		...options.headers,
	};
	const isFormData = options.body instanceof FormData;
	if (!isFormData && options.body) {
		headers['Content-Type'] = 'application/json';
	}

	const url = path;
	const res = await fetch(url, {
		...options,
		credentials: 'include',
		headers,
	});
	if (!res.ok) {
		const text = await res.text();
		console.error('[API ERROR]', options.method || 'GET', url, res.status, text);
		let message = text || `HTTP ${res.status}`;
		try {
			const parsed = JSON.parse(text);
			if (parsed.detail) message = parsed.detail;
		} catch {}
		throw new Error(message);
	}
	return res.json();
}

export async function getProfile() {
	return request(`${API_BASE}/profile`);
}

export async function updateProfile(profile) {
	return request(`${API_BASE}/profile`, {
		method: 'POST',
		body: JSON.stringify(profile),
	});
}

export async function createFeedback(data) {
	const form = new FormData();
	form.append('category', data.category);
	form.append('type', data.type);
	form.append('description', data.description);
	if (data.remark) form.append('remark', data.remark);
	if (data.guest_account) form.append('guest_account', data.guest_account);
	for (const file of data.screenshots) {
		form.append('screenshots', file);
	}
	return request(`${API_BASE}/`, {
		method: 'POST',
		body: form,
	});
}

export async function getMyFeedback() {
	return request(`${API_BASE}/me`);
}

export async function listFeedback(params = {}) {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
	}
	return request(`${API_BASE}/?${qs.toString()}`);
}

export async function updateFeedback(id, data) {
	return request(`${API_BASE}/${id}`, {
		method: 'POST',
		body: JSON.stringify(data),
	});
}

export async function getLeaderboard(params = {}) {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v) qs.append(k, v);
	}
	return request(`${API_BASE}/leaderboard?${qs.toString()}`);
}

export async function getCarousel(limit = 10) {
	return request(`${API_BASE}/carousel?limit=${limit}`);
}

export async function getAttachmentObjectUrl(id) {
	const token = getToken();
	const res = await fetch(`${API_BASE}/attachments/${id}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
		credentials: 'include',
	});
	if (!res.ok) throw new Error('Failed to load attachment');
	const blob = await res.blob();
	return URL.createObjectURL(blob);
}
