import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { statusLabel } from '../lib/format';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-brand text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset] hover:bg-brand-hover',
    secondary: 'border border-line bg-white text-ink hover:border-[#90e0ef] hover:bg-[#f3fbfe]',
    ghost: 'text-ink hover:bg-tint',
    danger: 'bg-danger text-white hover:bg-red-700',
  }[variant];
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs leading-5 text-muted">{hint}</span> : null}
    </label>
  );
}

const control = 'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink shadow-[0_1px_0_rgba(15,23,42,0.02)] outline-none transition placeholder:text-slate-400 focus:border-link focus:ring-4 focus:ring-[#caf0f8]';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${control} ${className}`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={control} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="min-h-24 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-link focus:ring-4 focus:ring-[#caf0f8]" {...props} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(3,4,94,0.04),0_12px_32px_-20px_rgba(3,4,94,0.35)] ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-sidebar">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({ value }: { value: string }) {
  const tone =
    value === 'PAID' || value === 'COMPLETED' || value === 'ACTIVE' || value === 'REVIEWED' || value === 'APPROVED' || value === 'DONE' || value === 'MATCHED' || value === 'PROCESSED' || value === 'FISCALIZED'
      ? 'bg-green-50 text-success'
      : value === 'OVERDUE' || value === 'CANCELLED' || value === 'REJECTED' || value === 'EXPIRED'
        ? 'bg-red-50 text-danger'
        : value === 'DRAFT' || value === 'PENDING' || value === 'TRIAL' || value === 'INTERNAL_DRAFT' || value === 'IN_REVIEW' || value === 'IN_PROGRESS' || value === 'UNMATCHED' || value === 'NEEDS_CLARIFICATION' || value === 'UNKNOWN' || value === 'PROCESSING' || value === 'READY' || value === 'NOT_SENT'
          ? 'bg-amber-50 text-warning'
          : 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabel[value] ?? value}</span>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[#e8f6fb] ${className}`} />;
}

export function Tabs({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onChange(item.id)} className={`shrink-0 border-b-2 px-3 py-2.5 text-sm transition ${value === item.id ? 'border-link font-semibold text-sidebar' : 'border-transparent text-muted hover:text-ink'}`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-tint text-sm font-semibold text-sidebar">—</div>
      <p className="font-display font-medium text-sidebar">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted">{text}</p>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Ndodhi një gabim.';
  return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>;
}
