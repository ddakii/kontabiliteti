export type FiscalEnvironmentName = 'TEST' | 'PRODUCTION';

export type AtkCall = {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
};

export type AtkResult = { status: number; body: unknown };

export type AtkTransport = (call: AtkCall) => Promise<AtkResult>;

export class AtkTransportError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network',
  ) {
    super(message);
    this.name = 'AtkTransportError';
  }
}

/** Adresat e dokumentuara në Program.cs të shembullit publik. */
export function atkBaseUrl(environment: FiscalEnvironmentName): string {
  if (environment === 'PRODUCTION') return 'https://fiskalizimi.atk-ks.org';
  return 'https://fiskalizimi-test.atk-ks.org';
}

export function atkUrl(environment: FiscalEnvironmentName, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Rruga e ATK-së është e pavlefshme.');
  return `${atkBaseUrl(environment)}${path}`;
}

export function sanitizeAtkMessage(body: unknown): string {
  let text = 'ATK ktheu një gabim pa mesazh të lexueshëm.';
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') text = body.error;
  else if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') text = body.message;
  if (/BEGIN |PRIVATE KEY|verification_code|fiscalization_no/i.test(text)) {
    return 'ATK ktheu një gabim. Detajet e ndjeshme nuk shfaqen.';
  }
  return text.replace(/\s+/g, ' ').slice(0, 400);
}

async function defaultTransport(call: AtkCall): Promise<AtkResult> {
  if (!call.url.startsWith('https://')) throw new AtkTransportError('ATK pranon vetëm HTTPS.', 'network');
  try {
    const response = await fetch(call.url, {
      method: call.method,
      headers: call.body === undefined ? undefined : { 'content-type': 'application/json', accept: 'application/json' },
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: AbortSignal.timeout(call.timeoutMs),
    });
    const raw = await response.text();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = { error: raw.slice(0, 300) };
      }
    }
    return { status: response.status, body };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AtkTransportError('ATK nuk u përgjigj brenda kohës.', 'timeout');
    }
    throw new AtkTransportError('Lidhja me ATK dështoi.', 'network');
  }
}

let transport: AtkTransport = defaultTransport;

export function setAtkTransport(next: AtkTransport) {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('Transporti i ATK-së nuk zëvendësohet në produksion.');
  }
  transport = next;
}

export function resetAtkTransport() {
  transport = defaultTransport;
}

export async function atkCall(call: AtkCall): Promise<AtkResult> {
  return transport(call);
}

export async function verifyBusiness(environment: FiscalEnvironmentName, nui: string, body: {
  fiscalization_no: string;
  pos_id: number;
  branch_id: number;
  application_id: number;
}) {
  return atkCall({
    url: atkUrl(environment, `/ca/verify/${nui}`),
    method: 'POST',
    body,
    timeoutMs: 15_000,
  });
}

export async function signCsr(environment: FiscalEnvironmentName, body: {
  business_name: string;
  business_id: number;
  branch_id: number;
  verification_code: string;
  pos_id: number;
  application_id: number;
  csr: string;
}) {
  return atkCall({
    url: atkUrl(environment, '/ca/signcsr'),
    method: 'POST',
    body,
    timeoutMs: 20_000,
  });
}

export async function submitPosCoupon(environment: FiscalEnvironmentName, body: { details: string; signature: string }) {
  return atkCall({
    url: atkUrl(environment, '/pos/coupon'),
    method: 'POST',
    body,
    timeoutMs: 20_000,
  });
}

export async function checkAtkHost(environment: FiscalEnvironmentName) {
  return atkCall({
    url: atkUrl(environment, '/swagger/index.html'),
    method: 'GET',
    timeoutMs: 8_000,
  });
}
