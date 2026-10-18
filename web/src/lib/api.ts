const FIRM_KEY = 'kontabiliteti.firmId';
const COMPANY_KEY = 'kontabiliteti.companyId';

export function getFirmId() {
  return localStorage.getItem(FIRM_KEY) ?? '';
}

export function getCompanyId() {
  return localStorage.getItem(COMPANY_KEY) ?? '';
}

export function setFirmId(id: string) {
  localStorage.setItem(FIRM_KEY, id);
}

export function setCompanyId(id: string) {
  localStorage.setItem(COMPANY_KEY, id);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Kontabiliteti-Request', '1');
  const firmId = getFirmId();
  const companyId = getCompanyId();
  if (firmId) headers.set('X-Firm-Id', firmId);
  if (companyId) headers.set('X-Company-Id', companyId);
  const response = await fetch(path, { ...options, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiError(response.status, 'HTTP', 'Kërkesa dështoi.');
    return (await response.blob()) as T;
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new ApiError(response.status, payload.error?.code ?? 'HTTP', payload.error?.message ?? 'Kërkesa dështoi.', payload.error?.details);
  }
  return payload.data as T;
}

export async function download(path: string, filename: string) {
  const headers = new Headers();
  headers.set('X-Kontabiliteti-Request', '1');
  if (getFirmId()) headers.set('X-Firm-Id', getFirmId());
  if (getCompanyId()) headers.set('X-Company-Id', getCompanyId());
  const response = await fetch(path, { headers, credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status, 'HTTP', 'Shkarkimi dështoi.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
