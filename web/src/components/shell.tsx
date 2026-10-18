import {
  Bell,
  Building2,
  CalendarDays,
  ChevronLeft,
  ClipboardList,
  FileText,
  FolderOpen,
  IdCard,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Receipt,
  Scale,
  Search,
  Stamp,
  Settings,
  Shield,
  Users,
  Wallet,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Badge } from './ui';

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; permission?: string };

const groups: { title: string; items: NavItem[] }[] = [
  {
    title: 'Paneli',
    items: [
      { to: '/', label: 'Paneli kryesor', icon: LayoutDashboard, end: true },
      { to: '/detyrat', label: 'Detyrat', icon: ClipboardList, permission: 'tasks.manage' },
      { to: '/kalendari', label: 'Kalendari', icon: CalendarDays, permission: 'tasks.manage' },
    ],
  },
  {
    title: 'Klientët',
    items: [
      { to: '/klientet', label: 'Kompanitë', icon: Building2 },
      { to: '/dokumentet', label: 'Dokumentet', icon: FolderOpen, permission: 'documents.read' },
      { to: '/portali', label: 'Portali', icon: Users },
    ],
  },
  {
    title: 'Kontabiliteti',
    items: [
      { to: '/faturat', label: 'Faturat', icon: FileText, permission: 'invoices.read' },
      { to: '/blerjet', label: 'Blerjet', icon: Receipt, permission: 'purchases.read' },
      { to: '/puntoret', label: 'Punëtorët', icon: IdCard, permission: 'payroll.read' },
      { to: '/pagesat', label: 'Pagesat', icon: Wallet, permission: 'accounting.read' },
      { to: '/bankat', label: 'Bankat dhe arka', icon: Landmark, permission: 'accounting.read' },
      { to: '/muaji', label: 'Muaji kontabël', icon: CalendarDays, permission: 'tasks.manage' },
      { to: '/kontabiliteti', label: 'Ditari dhe plani', icon: Scale, permission: 'accounting.read' },
    ],
  },
  {
    title: 'Tatimet dhe raportet',
    items: [
      { to: '/tvsh', label: 'TVSH dhe tatimet', icon: Landmark, permission: 'tax.read' },
      { to: '/fiskalizimi', label: 'Fiskalizimi ATK', icon: Stamp, permission: 'fiscal.read' },
      { to: '/raportet', label: 'Raportet', icon: ClipboardList, permission: 'reports.read' },
    ],
  },
  {
    title: 'Administrimi',
    items: [
      { to: '/ekipi', label: 'Ekipi', icon: Users, permission: 'firm.members' },
      { to: '/abonimi', label: 'Abonimi', icon: Settings, permission: 'firm.billing' },
      { to: '/auditimi', label: 'Auditimi', icon: Shield, permission: 'reports.read' },
    ],
  },
];

const crumbs: Record<string, string> = {
  '/': 'Paneli kryesor',
  '/klientet': 'Kompanitë',
  '/faturat': 'Faturat',
  '/blerjet': 'Blerjet',
  '/puntoret': 'Punëtorët',
  '/pagesat': 'Pagesat',
  '/bankat': 'Bankat dhe arka',
  '/muaji': 'Muaji kontabël',
  '/kontabiliteti': 'Kontabiliteti',
  '/tvsh': 'TVSH dhe tatimet',
  '/fiskalizimi': 'Fiskalizimi ATK',
  '/raportet': 'Raportet',
  '/detyrat': 'Detyrat',
  '/kalendari': 'Kalendari',
  '/dokumentet': 'Dokumentet',
  '/ekipi': 'Ekipi',
  '/abonimi': 'Abonimi',
  '/auditimi': 'Auditimi',
  '/kerko': 'Kërkimi',
  '/vjetersimi': 'Vjetërsimi',
  '/platforma': 'Platforma',
};

type Company = { id: string; legalName: string; status: string; municipality?: string | null };

export function AppShell() {
  const { profile, firmId, companyId, chooseFirm, chooseCompany } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(localStorage.getItem('kontabiliteti.sidebar') === '1');
  const [query, setQuery] = useState('');
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const permissions = profile?.firms.find((firm) => firm.id === firmId)?.permissions;
  const allowed = (item: NavItem) => !item.permission || !permissions || permissions.includes(item.permission);
  const companies = useQuery({
    queryKey: ['companies', firmId],
    enabled: Boolean(firmId),
    queryFn: () => api<Company[]>('/api/companies?pageSize=100').then((result) => (Array.isArray(result) ? result : [])),
  });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ id: string; title: string; readAt?: string | null }[]>('/api/notifications'),
  });
  const search = useQuery({
    queryKey: ['palette', paletteQuery],
    enabled: palette && paletteQuery.trim().length > 1,
    queryFn: () => api<Record<string, { id: string; legalName?: string; displayNumber?: string; name?: string; title?: string }[]>>(`/api/search?q=${encodeURIComponent(paletteQuery)}`),
  });
  const list = companies.data ?? [];
  const active = list.find((company) => company.id === companyId);
  const unread = (notifications.data ?? []).filter((item) => !item.readAt).length;
  const actions = useMemo(() => [
    { label: 'Shto kompani kliente', to: '/klientet', permission: 'companies.create' },
    { label: 'Krijo faturë', to: '/faturat', permission: 'invoices.write' },
    { label: 'Regjistro blerje', to: '/blerjet', permission: 'purchases.write' },
    { label: 'Shto punëtor', to: '/puntoret', permission: 'payroll.write' },
    { label: 'Ngarko dokument', to: '/dokumentet', permission: 'documents.write' },
    { label: 'Regjistro pagesë', to: '/pagesat', permission: 'payments.write' },
    { label: 'Krijo detyrë', to: '/detyrat', permission: 'tasks.manage' },
    { label: 'Hap kalendarin', to: '/kalendari', permission: 'tasks.manage' },
  ].filter((action) => !action.permission || !permissions || permissions.includes(action.permission)), [permissions]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(true);
      }
      if (event.key === 'Escape') setPalette(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const section = Object.entries(crumbs).find(([path]) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)))?.[1] ?? 'Kontabiliteti Pro';

  const iconButton = 'grid h-10 w-10 place-items-center rounded-lg border border-line bg-white text-ink transition hover:border-[#90e0ef] hover:bg-[#f3fbfe]';

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className={`fixed inset-y-0 left-0 z-30 flex flex-col bg-sidebar text-[#ade8f4] transition-all ${collapsed ? 'w-[4.5rem]' : 'w-72'} ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="flex h-[4.5rem] items-center gap-3 border-b border-white/10 px-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-white shadow-[inset_0_-3px_0_#00b4d8]">
            <span className="font-display text-sm font-semibold tracking-tight">Kp</span>
          </div>
          {collapsed ? null : <div><p className="font-display text-sm font-semibold text-white">Kontabiliteti Pro</p><p className="text-xs text-[#90e0ef]">Kosovë</p></div>}
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
          {groups.map((group) => {
            const items = group.items.filter(allowed);
            if (items.length === 0) return null;
            return (
              <div key={group.title}>
                {collapsed ? null : <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#48cae4]">{group.title}</p>}
                <div className="space-y-0.5">
                  {items.map((link) => (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      end={link.end}
                      title={link.label}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? 'bg-brand text-white shadow-[inset_3px_0_0_#00b4d8]' : 'text-[#ade8f4] hover:bg-white/8 hover:text-white'}`}
                    >
                      <link.icon size={16} />
                      {collapsed ? null : link.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <button type="button" className="m-3 hidden h-10 items-center justify-center rounded-lg text-[#90e0ef] hover:bg-white/8 lg:flex" onClick={() => { const next = !collapsed; setCollapsed(next); localStorage.setItem('kontabiliteti.sidebar', next ? '1' : '0'); }} aria-label="Palos menunë">
          <ChevronLeft size={16} className={collapsed ? 'rotate-180' : ''} />
        </button>
      </aside>
      {open ? <button className="fixed inset-0 z-20 bg-[#03045e]/40 lg:hidden" onClick={() => setOpen(false)} aria-label="Mbyll menunë" /> : null}
      <div className={collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-72'}>
        <header className="no-print sticky top-0 z-10 flex h-[4.5rem] items-center gap-2 border-b border-line bg-white/95 px-4 backdrop-blur">
          <button className={`${iconButton} lg:hidden`} onClick={() => setOpen(true)} aria-label="Hap menunë"><Menu size={16} /></button>
          <form className="relative hidden min-w-0 flex-1 md:block" onSubmit={(event) => { event.preventDefault(); navigate(`/kerko?q=${encodeURIComponent(query)}`); }}>
            <Search className="absolute left-3 top-3 text-muted" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kërko kompani, fatura, dokumente…" className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-16 text-sm outline-none transition focus:border-link focus:ring-4 focus:ring-tint" />
            <span className="pointer-events-none absolute right-3 top-2.5 hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted lg:inline">Ctrl K</span>
          </form>
          <button type="button" className="hidden h-10 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover md:inline-flex" onClick={() => setPalette(true)}><Plus size={14} /> Veprime</button>
          <select className="h-10 max-w-44 rounded-lg border border-line bg-white px-2 text-sm" value={firmId} onChange={(event) => chooseFirm(event.target.value)} aria-label="Zyra e kontabilitetit">
            {profile?.firms.map((firm) => <option key={firm.id} value={firm.id}>{firm.legalName}</option>)}
          </select>
          <select className="h-10 max-w-56 rounded-lg border border-[#90e0ef] bg-tint px-2 text-sm font-medium text-sidebar" value={companyId} onChange={(event) => chooseCompany(event.target.value)} aria-label="Kompania aktive">
            <option value="">Zgjidhni kompaninë</option>
            {list.map((company) => <option key={company.id} value={company.id}>{company.legalName}</option>)}
          </select>
          <button className={`relative ${iconButton}`} aria-label="Njoftimet" onClick={() => navigate('/detyrat')}>
            <Bell size={16} />
            {unread > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-warning" /> : null}
          </button>
          <button className={iconButton} aria-label="Dil" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.href = '/hyrje'; }}><LogOut size={16} /></button>
        </header>
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-4 py-2.5 text-sm">
          <p className="font-medium text-link">{section}</p>
          {active ? <p><span className="text-muted">Kompania aktive</span> <strong className="text-sidebar">{active.legalName}</strong>{active.municipality ? <span className="text-muted"> · {active.municipality}</span> : null} <span className="ml-2"><Badge value={active.status} /></span></p> : <p className="text-warning">Zgjidhni kompaninë kliente para se të regjistroni dokumente.</p>}
        </div>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8"><Outlet /></main>
      </div>
      {palette ? (
        <div className="fixed inset-0 z-40 grid place-items-start bg-[#03045e]/45 px-4 pt-24" onClick={() => setPalette(false)}>
          <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_80px_-24px_rgba(3,4,94,0.45)]" onClick={(event) => event.stopPropagation()}>
            <input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Kërkoni ose zgjidhni një veprim" className="h-14 w-full border-b border-line px-4 text-sm outline-none" />
            <div className="max-h-80 overflow-auto p-2">
              {actions.filter((action) => action.label.toLowerCase().includes(paletteQuery.toLowerCase())).map((action) => (
                <button key={action.label} type="button" className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-tint" onClick={() => { setPalette(false); navigate(action.to); }}>{action.label}</button>
              ))}
              {Object.entries(search.data ?? {}).flatMap(([key, rows]) => rows.map((row) => {
                const label = row.legalName ?? row.displayNumber ?? row.name ?? row.title ?? row.id;
                const target = key === 'companies' ? `/klientet/${row.id}` : key === 'invoices' ? `/faturat/${row.id}` : key === 'purchases' ? `/blerjet/${row.id}` : `/kerko?q=${encodeURIComponent(paletteQuery)}`;
                return (
                  <button key={`${key}-${row.id}`} type="button" className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-tint" onClick={() => { setPalette(false); navigate(target); }}>
                    <span className="text-muted">{key}</span> · {label}
                  </button>
                );
              }))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
