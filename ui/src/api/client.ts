/** REST API 客户端：按契约走相对路径 /api，同源无 CORS */

export interface Me {
  id: string;
  name: string;
  role?: string;
  avatar?: string;
  /** 认证模式：header=反向代理注入，oidc=OIDC 会话（可登出），dev=本地开发 */
  auth_mode: 'header' | 'oidc' | 'dev';
}

export interface DrawingSummary {
  id: number;
  title: string;
  thumbnail: string | null;
  created_at: number;
  updated_at: number;
}

export interface Drawing extends DrawingSummary {
  code: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<Me>('/api/me'),
  listDrawings: () => request<DrawingSummary[]>('/api/drawings'),
  getDrawing: (id: number) => request<Drawing>(`/api/drawings/${id}`),
  createDrawing: (body: { title: string; code: string; thumbnail: string }) =>
    request<{ id: number }>('/api/drawings', { method: 'POST', body: JSON.stringify(body) }),
  updateDrawing: (id: number, body: { title?: string; code?: string; thumbnail?: string }) =>
    request<{ ok: boolean }>(`/api/drawings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteDrawing: (id: number) =>
    request<{ ok: boolean }>(`/api/drawings/${id}`, { method: 'DELETE' }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
};
