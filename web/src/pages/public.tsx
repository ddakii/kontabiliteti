import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, ErrorNote, Field, Input } from '../components/ui';

export function HomePage() {
  return (
    <div className="min-h-screen bg-sidebar text-white">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="mb-8 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand shadow-[inset_0_-3px_0_#00b4d8]"><span className="font-display text-sm font-semibold">Kp</span></div>
            <p className="font-display text-sm font-semibold tracking-wide text-[#ade8f4]">Kontabiliteti Pro KS</p>
          </div>
          <h1 className="font-display max-w-xl text-5xl font-semibold leading-[1.1] tracking-tight">Zyra e kontabilitetit, të gjitha kompanitë, një hyrje.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#ade8f4]">
            Platformë për zyrat e kontabilitetit në Kosovë: fatura, blerje, libër dyfishtë, TVSH e përgatitur brenda zyrës dhe abonim i kontrolluar.
          </p>
          <div className="mt-8 flex gap-3">
            <Link to="/regjistrohu" className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-sidebar">Krijo zyrën</Link>
            <Link to="/hyrje" className="rounded-lg border border-[#48cae4] px-4 py-2.5 text-sm text-[#caf0f8]">Hyr</Link>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-6 text-sm leading-6 text-ink shadow-[0_24px_80px_-28px_rgba(0,180,216,0.7)]">
          <p className="font-display text-lg font-semibold text-sidebar">Kufiri i produktit</p>
          <p className="mt-3 text-[#475569]">Nuk është certifikim fiskal dhe nuk dorëzon deklarata te ATK.</p>
          <p className="mt-3 text-[#475569]">Normat tatimore konfirmohen nga kontabilisti pasi të verifikohen me legjislacionin aktual.</p>
        </div>
      </div>
    </div>
  );
}

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <div className="hidden bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand shadow-[inset_0_-3px_0_#00b4d8]"><span className="font-display text-sm font-semibold">Kp</span></div>
          <p className="font-display text-sm text-[#ade8f4]">Kontabiliteti Pro</p>
        </div>
        <div>
          <h1 className="font-display max-w-md text-4xl font-semibold leading-tight">Kontabilitet i ndarë për çdo kompani kliente.</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-[#90e0ef]">Faturat, blerjet, punëtorët dhe raportet qëndrojnë brenda kompanisë së zgjedhur.</p>
        </div>
        <p className="text-xs text-[#48cae4]">Kosovë · EUR · DD.MM.YYYY</p>
      </div>
      <div className="flex items-center justify-center bg-canvas px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-[0_16px_40px_-28px_rgba(3,4,94,0.45)]">
          <h2 className="font-display text-2xl font-semibold text-sidebar">{title}</h2>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [error, setError] = useState<unknown>();
  const [challenge, setChallenge] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      if (challenge) {
        await api('/api/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ challengeToken: challenge, code: form.get('code') }) });
      } else {
        const result = await api<{ requiresTwoFactor?: boolean; challengeToken?: string }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
        });
        if (result.requiresTwoFactor && result.challengeToken) {
          setChallenge(result.challengeToken);
          return;
        }
      }
      await refresh();
      navigate('/');
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <AuthCard title="Hyrje">
      <form className="space-y-4" onSubmit={onSubmit}>
        {error ? <ErrorNote error={error} /> : null}
        {challenge ? (
          <Field label="Kodi i verifikimit"><Input name="code" inputMode="numeric" required /></Field>
        ) : (
          <>
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <Field label="Fjalëkalimi"><Input name="password" type="password" required /></Field>
          </>
        )}
        <Button className="w-full" type="submit">Vazhdo</Button>
        <p className="text-sm text-muted"><Link className="font-medium text-link" to="/fjalekalimi">Keni harruar fjalëkalimin?</Link> · <Link className="font-medium text-link" to="/regjistrohu">Regjistro zyrën</Link></p>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const [error, setError] = useState<unknown>();
  const [token, setToken] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ devVerificationToken?: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          firmName: form.get('firmName'),
          planCode: form.get('planCode'),
        }),
      });
      setToken(result.devVerificationToken ?? '');
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <AuthCard title="Regjistroni zyrën">
      <form className="space-y-4" onSubmit={onSubmit}>
        {error ? <ErrorNote error={error} /> : null}
        {token ? <p className="text-sm">Në zhvillim, verifikoni me këtë kod: <Link className="font-medium text-link" to={`/verifiko-emailin?token=${token}`}>verifiko</Link></p> : null}
        <Field label="Emri juaj"><Input name="name" required /></Field>
        <Field label="Email"><Input name="email" type="email" required /></Field>
        <Field label="Fjalëkalimi" hint="Të paktën 10 karaktere, me shkronja dhe numra."><Input name="password" type="password" required /></Field>
        <Field label="Emri i zyrës"><Input name="firmName" required /></Field>
        <Field label="Plani i provës">
          <select name="planCode" className="h-10 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-link focus:ring-4 focus:ring-tint" defaultValue="PROFESSIONAL">
            <option value="STARTER">Starter</option>
            <option value="PROFESSIONAL">Professional</option>
            <option value="BUSINESS">Business</option>
          </select>
        </Field>
        <Button className="w-full" type="submit">Fillo provën</Button>
        <p className="text-xs text-muted">Prova nuk është pagesë. Çmimet i cakton administratori i platformës.</p>
      </form>
    </AuthCard>
  );
}

export function VerifyPage() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: form.get('token') }) });
      setMessage('Emaili u verifikua. Tani mund të hyni.');
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <AuthCard title="Verifikimi i emailit">
      <form className="space-y-4" onSubmit={onSubmit}>
        {error ? <ErrorNote error={error} /> : null}
        {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
        <Field label="Kodi i verifikimit"><Input name="token" defaultValue={params.get('token') ?? ''} required /></Field>
        <Button type="submit">Verifiko</Button>
      </form>
    </AuthCard>
  );
}

export function ForgotPage() {
  const [info, setInfo] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api<{ message: string; devResetToken?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email') }),
    });
    setInfo(result.devResetToken ? `${result.message} Kodi i zhvillimit: ${result.devResetToken}` : result.message);
  }
  return (
    <AuthCard title="Rivendosja e fjalëkalimit">
      <form className="space-y-4" onSubmit={onSubmit}>
        {info ? <p className="text-sm">{info}</p> : null}
        <Field label="Email"><Input name="email" type="email" required /></Field>
        <Button type="submit">Dërgo udhëzimet</Button>
      </form>
    </AuthCard>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: form.get('token'), password: form.get('password') }) });
      setMessage('Fjalëkalimi u rivendos.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : caught);
    }
  }
  return (
    <AuthCard title="Fjalëkalim i ri">
      <form className="space-y-4" onSubmit={onSubmit}>
        {error ? <ErrorNote error={error} /> : null}
        {message ? <p className="text-sm">{message}</p> : null}
        <Field label="Kodi"><Input name="token" defaultValue={params.get('token') ?? ''} required /></Field>
        <Field label="Fjalëkalimi i ri"><Input name="password" type="password" required /></Field>
        <Button type="submit">Ruaj</Button>
      </form>
    </AuthCard>
  );
}

export function InvitePage() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/auth/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token: form.get('token'), name: form.get('name') || undefined, password: form.get('password') || undefined }),
      });
      setMessage('Ftesa u pranua. Hyni me emailin tuaj.');
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <AuthCard title="Pranoni ftesën">
      <form className="space-y-4" onSubmit={onSubmit}>
        {error ? <ErrorNote error={error} /> : null}
        {message ? <p className="text-sm">{message}</p> : null}
        <Field label="Kodi i ftesës"><Input name="token" defaultValue={params.get('token') ?? ''} required /></Field>
        <Field label="Emri, nëse nuk keni llogari"><Input name="name" /></Field>
        <Field label="Fjalëkalimi, nëse nuk keni llogari"><Input name="password" type="password" /></Field>
        <Button type="submit">Prano</Button>
      </form>
    </AuthCard>
  );
}
