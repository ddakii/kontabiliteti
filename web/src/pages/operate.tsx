import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Skeleton, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMoney, todayInput } from '../lib/format';
import { useSession } from '../lib/session';

type Row = Record<string, unknown>;

function favorites() {
  return JSON.parse(localStorage.getItem('kontabiliteti.favorites') ?? '[]') as string[];
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { chooseCompany } = useSession();
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Row>('/api/dashboard') });
  const queue = useQuery({ queryKey: ['work-queue'], queryFn: () => api<Row[]>('/api/work-queue') });
  if (dashboard.isLoading) return <Skeleton className="h-40" />;
  if (dashboard.error) return <ErrorNote error={dashboard.error} />;
  const data = dashboard.data ?? {};
  const tasks = (data.tasksByStatus ?? {}) as Record<string, number>;
  const chart = Object.entries(tasks).map(([name, value]) => ({ name, value }));
  const workload = (data.workload ?? []) as Row[];
  const cards = [
    ['Kompanitë', data.companiesTotal],
    ['Aktive', data.activeCompanies],
    ['Kërkesa dokumentesh', data.missingDocuments],
    ['Fatura me vonesë', data.overdueInvoices],
    ['Draftet', data.draftInvoices],
    ['Blerje të pashqyrtuara', data.unreviewedPurchases],
  ];
  return (
    <div>
      <PageHeader title="Paneli i zyrës" description="Radha e punës vjen nga regjistrimet e zyrës. Shifrat financiare të kompanive nuk bashkohen." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value]) => (
          <Card key={String(label)} className="metric px-4 py-4">
            <p className="text-sm text-muted">{String(label)}</p>
            <p className="tabular mt-1 text-2xl font-semibold">{String(value ?? 0)}</p>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Radha e punës</h2>
          {(queue.data ?? []).length === 0 ? <Empty title="Nuk ka punë të hapur" text="Detyrat, dokumentet dhe periudhat e hapura shfaqen këtu." /> : (
            <div className="divide-y divide-line">
              {(queue.data ?? []).map((item) => (
                <button key={String(item.id)} type="button" className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-3 text-left hover:bg-[#f3fbfe]" onClick={() => { if (item.companyId) chooseCompany(String(item.companyId)); navigate(String(item.href)); }}>
                  <span>
                    <span className="block text-sm font-medium">{String(item.title)}</span>
                    <span className="text-xs text-muted">{String(item.companyName)} · {String(item.detail)}</span>
                  </span>
                  <span className="inline-flex h-8 shrink-0 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white">{String(item.action ?? 'Hap')}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Ngarkesa e ekipit</h2>
            {workload.length === 0 ? <p className="text-sm text-muted">Nuk ka anëtarë.</p> : workload.map((member) => (
              <p key={String(member.userId)} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{String(member.name)}</span><span className="tabular text-muted">{String(member.openTasks)} detyra</span></p>
            ))}
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Detyrat sipas statusit</h2>
            {chart.length === 0 ? <p className="text-sm text-muted">Nuk ka detyra.</p> : (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart}><XAxis dataKey="name" hide /><YAxis allowDecimals={false} width={24} /><Tooltip /><Bar dataKey="value" fill="#0077b6" radius={[6, 6, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-3 text-sm text-muted">Plani: {String((data.subscription as Row | null)?.plan ?? '—')} · kufiri {String((data.subscription as Row | null)?.maxCompanies ?? 'pa kufi')} kompani</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function DirectoryPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [q, setQ] = useState('');
  const [view, setView] = useState('all');
  const [favs, setFavs] = useState(favorites);
  const companies = useQuery({ queryKey: ['directory'], queryFn: () => api<Row[]>('/api/directory') });
  const municipalities = useQuery({ queryKey: ['municipalities'], queryFn: () => api<string[]>('/api/municipalities') });
  const rows = (companies.data ?? []).filter((company) => {
    const name = String(company.legalName).toLowerCase();
    if (q && !name.includes(q.toLowerCase())) return false;
    if (view === 'docs') return Number(company.openDocumentRequests) > 0;
    if (view === 'inactive') return ['ARCHIVED', 'SUSPENDED'].includes(String(company.status));
    if (view === 'favorites') return favs.includes(String(company.id));
    if (view === 'active') return company.status === 'ACTIVE';
    return true;
  });
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api('/api/companies', { method: 'POST', body: JSON.stringify({ legalName: form.get('legalName'), fiscalNumber: form.get('fiscalNumber') || undefined, municipality: form.get('municipality') || undefined, address: form.get('address') || undefined, vatStatus: form.get('vatStatus'), accountingStartDate: form.get('accountingStartDate') }) });
      await queryClient.invalidateQueries({ queryKey: ['directory'] });
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      formElement.reset();
      setError(undefined);
    } catch (caught) { setError(caught); }
  }
  return (
    <div>
      <PageHeader title="Kompanitë e klientëve" description="Çdo kompani ka librin dhe dokumentet e veta." />
      <div className="mb-3 flex flex-wrap gap-2">
        {[['all', 'Të gjitha'], ['active', 'Aktive'], ['docs', 'Në pritje të dokumenteve'], ['favorites', 'Të preferuarat'], ['inactive', 'Joaktive']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)} className={`chip ${view === id ? 'chip-active' : ''}`}>{label}</button>
        ))}
        <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Kërko emrin" className="max-w-xs" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-muted"><tr><th className="px-4 py-3">Emri</th><th>Komuna</th><th>TVSH</th><th>Detyra</th><th>Dokumente</th><th>Aktiviteti</th><th>Statusi</th></tr></thead>
              <tbody>
                {rows.map((company) => (
                  <tr key={String(company.id)} className="border-b border-line">
                    <td className="px-4 py-3"><button type="button" className="mr-2 text-muted" aria-label="Preferuar" onClick={() => { const next = favs.includes(String(company.id)) ? favs.filter((id) => id !== company.id) : [...favs, String(company.id)]; localStorage.setItem('kontabiliteti.favorites', JSON.stringify(next)); setFavs(next); }}>{favs.includes(String(company.id)) ? '★' : '☆'}</button><Link className="font-medium text-link" to={`/klientet/${company.id}`}>{String(company.legalName)}</Link></td>
                    <td>{String(company.municipality ?? '—')}</td>
                    <td>{String(company.vatStatus)}</td>
                    <td className="tabular">{String(company.openTasks ?? 0)}</td>
                    <td className="tabular">{String(company.openDocumentRequests ?? 0)}</td>
                    <td className="text-muted">{formatDateTime(company.lastActivityAt ? String(company.lastActivityAt) : null)}</td>
                    <td><Badge value={String(company.status)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <Empty title="Asnjë kompani në këtë pamje" text="Ndryshoni filtrin ose shtoni një kompani." /> : null}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Kompani e re</h2>
          <form className="space-y-3" onSubmit={onSubmit}>
            {error ? <ErrorNote error={error} /> : null}
            <Field label="Emri ligjor"><Input name="legalName" required /></Field>
            <Field label="Numri fiskal"><Input name="fiscalNumber" /></Field>
            <Field label="Komuna"><Select name="municipality">{(municipalities.data ?? []).map((name) => <option key={name}>{name}</option>)}</Select></Field>
            <Field label="Adresa"><Input name="address" /></Field>
            <Field label="Statusi i TVSH-së"><Select name="vatStatus" defaultValue="UNKNOWN"><option value="REGISTERED">I regjistruar</option><option value="NOT_REGISTERED">I paregjistruar</option><option value="UNKNOWN">I papërcaktuar</option></Select></Field>
            <Field label="Fillimi i kontabilitetit"><Input name="accountingStartDate" type="date" required defaultValue={todayInput()} /></Field>
            <Button type="submit">Ruaj kompaninë</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function CompanyWorkspacePage() {
  const { id = '' } = useParams();
  const { chooseCompany } = useSession();
  const [tab, setTab] = useState('summary');
  const company = useQuery({ queryKey: ['company-profile', id], queryFn: () => api<Row>(`/api/companies/${id}`) });
  const health = useQuery({ queryKey: ['company-health', id], queryFn: () => api<Row>(`/api/companies/${id}/health`) });
  const readiness = useQuery({ queryKey: ['company-readiness', id], queryFn: () => api<Row>(`/api/companies/${id}/readiness`) });
  if (company.isLoading) return <Skeleton className="h-40" />;
  if (!company.data) return <ErrorNote error={company.error ?? new Error('Kompania nuk u gjet.')} />;
  const data = company.data;
  const factors = (readiness.data?.factors ?? []) as Row[];
  const timeline = (health.data?.timeline ?? []) as Row[];
  return (
    <div>
      <PageHeader title={String(data.legalName)} description={String(readiness.data?.disclaimer ?? '')} action={<Badge value={String(data.status)} />} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card className="p-4"><p className="text-sm text-muted">Gatishmëria operative</p><p className="tabular text-2xl font-semibold">{String(readiness.data?.score ?? '—')}</p><p className="text-sm">{String(readiness.data?.label ?? '')}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Detyra të hapura</p><p className="text-2xl font-semibold">{String(health.data?.openTasks ?? 0)}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Dokumente që mungojnë</p><p className="text-2xl font-semibold">{String(health.data?.missingDocs ?? 0)}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Fatura me vonesë</p><p className="text-2xl font-semibold">{String(health.data?.overdueInvoices ?? 0)}</p></Card>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'summary', label: 'Përmbledhje' }, { id: 'reasons', label: 'Pse ky status' }, { id: 'history', label: 'Historiku' }]} />
      {tab === 'summary' ? (
        <Card className="p-4 text-sm">
          <p>Numri fiskal: {String(data.fiscalNumber ?? '—')}</p>
          <p>Numri i biznesit: {String(data.businessNumber ?? '—')}</p>
          <p>TVSH: {String(data.vatNumber ?? '—')} · {String(data.vatStatus)}</p>
          <p>Komuna: {String(data.municipality ?? '—')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="chip" to="/faturat">Faturat</Link>
            <Link className="chip" to="/muaji">Muaji</Link>
            <Link className="chip" to="/raportet">Raportet</Link>
            <Link className="chip" to="/fiskalizimi" onClick={() => chooseCompany(id)}>Fiskalizimi ATK</Link>
          </div>
        </Card>
      ) : null}
      {tab === 'reasons' ? (
        <Card className="p-4 text-sm">
          {factors.length === 0 ? <p>Nuk ka faktorë të hapur në llogaritjen aktuale.</p> : factors.map((factor) => <p key={String(factor.key)} className="border-b border-line py-2">{String(factor.label)}: <strong>{String(factor.count)}</strong></p>)}
        </Card>
      ) : null}
      {tab === 'history' ? (
        <Card className="p-4 text-sm">{timeline.map((event) => <p key={String(event.id)} className="border-b border-line py-2"><span className="text-muted">{formatDateTime(String(event.createdAt))}</span> · {String(event.summary)}</p>)}</Card>
      ) : null}
    </div>
  );
}

export function MonthPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const checklist = useQuery({
    queryKey: ['company', companyId, 'month', year, month],
    enabled: Boolean(companyId),
    queryFn: () => api<Row>(`/api/month-checklist?year=${year}&month=${month}`),
  });
  const items = (checklist.data?.items ?? []) as Row[];
  const done = items.filter((item) => item.status === 'DONE' || item.status === 'NOT_APPLICABLE').length;
  return (
    <div>
      <PageHeader title="Muaji kontabël" description="Lista është kontroll i brendshëm. Përfundimi i një pike nuk e mbyll periudhën dhe nuk është deklaratë tatimore." />
      {!companyId ? <Empty title="Zgjidhni kompaninë" text="Muaji i takon kompanisë aktive." /> : (
        <>
          <div className="mb-4 flex gap-2">
            <Input type="number" value={month} onChange={(event) => setMonth(Number(event.target.value))} className="w-24" aria-label="Muaji" />
            <Input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="w-32" aria-label="Viti" />
          </div>
          <Card className="p-4">
            <p className="mb-3 text-sm text-muted">{done}/{items.length || 0} pika të mbyllura ose të pazbatueshme. {String(checklist.data?.note ?? '')}</p>
            {items.map((item) => (
              <div key={String(item.id)} className="grid gap-2 border-t border-line py-3 md:grid-cols-[1fr_180px]">
                <div>
                  <p className="text-sm font-medium">{String(item.title)}</p>
                  {item.completedAt ? <p className="text-xs text-muted">Shënuar më {formatDateTime(String(item.completedAt))}</p> : null}
                </div>
                <Select value={String(item.status)} onChange={async (event) => { await api(`/api/month-checklist/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'month', year, month] }); }} aria-label={String(item.title)}>
                  <option value="OPEN">E hapur</option>
                  <option value="IN_PROGRESS">Në proces</option>
                  <option value="DONE">E përfunduar</option>
                  <option value="NOT_APPLICABLE">Nuk zbatohet</option>
                </Select>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

export function InboxPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const documents = useQuery({ queryKey: ['inbox'], queryFn: () => api<Row[]>('/api/document-inbox') });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.set('file', file);
      body.set('category', 'OTHER');
      await api('/api/documents', { method: 'POST', body });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });
  return (
    <div>
      <PageHeader title="Qendra e dokumenteve" description="Skedarët ruhen privatisht. OCR nuk është i konfiguruar, prandaj të dhënat futen dhe shqyrtohen nga kontabilisti." />
      <label className="mb-4 block rounded-lg border border-dashed border-line bg-white px-4 py-8 text-center text-sm text-muted">
        {companyId ? 'Tërhiqni një skedar këtu ose zgjidheni. Ngarkohet te kompania aktive.' : 'Zgjidhni kompaninë para ngarkimit.'}
        <input className="mt-3 block w-full text-sm" type="file" disabled={!companyId} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} />
      </label>
      {upload.error ? <ErrorNote error={upload.error} /> : null}
      <Card>
        {(documents.data ?? []).map((document) => (
          <div key={String(document.id)} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm">
            <div><p className="font-medium">{String(document.originalName)}</p><p className="text-muted">{String(document.companyName)} · {String(document.category)}</p></div>
            <Badge value={String(document.status)} />
          </div>
        ))}
        {(documents.data ?? []).length === 0 ? <Empty title="Kutia është bosh" text="Dokumentet e ngarkuara të kompanive të autorizuara shfaqen këtu." /> : null}
      </Card>
    </div>
  );
}

export function BanksPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const workspace = useQuery({ queryKey: ['company', companyId, 'banks-workspace'], enabled: Boolean(companyId), queryFn: () => api<Row>('/api/bank-workspace') });
  const suggestions = (workspace.data?.suggestions ?? []) as Row[];
  const transactions = (workspace.data?.transactions ?? []) as Row[];
  return (
    <div>
      <PageHeader title="Bankat dhe arka" description={String(workspace.data?.note ?? 'Importi është nga skedar. Nuk ka lidhje automatike me bankën.')} />
      {error ? <div className="mb-3"><ErrorNote error={error} /></div> : null}
      <Card className="mb-4 p-4">
        <h2 className="mb-2 text-sm font-semibold">Përputhje të sugjeruara</h2>
        {suggestions.length === 0 ? <p className="text-sm text-muted">Nuk ka shuma që përputhen me fatura të papaguara.</p> : suggestions.map((suggestion) => (
          <div key={String(suggestion.transactionId)} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 text-sm">
            <div><p>{String(suggestion.description)} · {formatMoney(String(suggestion.amount))}</p><p className="text-muted">{String(suggestion.reason)} {String(suggestion.displayNumber ?? '')}</p></div>
            <Button onClick={async () => { try { await api(`/api/bank-transactions/${suggestion.transactionId}/match`, { method: 'POST', body: JSON.stringify({ invoiceId: suggestion.invoiceId, confirm: true }) }); await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'banks-workspace'] }); setError(undefined); } catch (caught) { setError(caught); } }}>Konfirmo dhe posto</Button>
          </div>
        ))}
      </Card>
      <Card>
        {transactions.map((row) => <div key={String(row.id)} className="flex justify-between border-b border-line px-4 py-3 text-sm"><span>{formatDate(String(row.bookedOn))} · {String(row.description)}</span><span className="flex items-center gap-2"><span className="tabular">{formatMoney(String(row.amount))}</span><Badge value={String(row.matchStatus)} /></span></div>)}
        {transactions.length === 0 ? <Empty title="Nuk ka transaksione" text="Importoni një ekstrakt CSV nga faqja e dokumenteve ose API-ja e importit." /> : null}
      </Card>
    </div>
  );
}

export function CalendarPage() {
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<Row[]>('/api/tasks') });
  const dated = (tasks.data ?? []).filter((task) => task.dueDate);
  return (
    <div>
      <PageHeader title="Kalendari" description="Afatet e detyrave të brendshme. Përfundimi i detyrës nuk është dorëzim te ATK." />
      <Card>
        {dated.map((task) => <div key={String(task.id)} className="flex items-center justify-between border-b border-line px-4 py-3 text-sm"><span><strong>{formatDate(String(task.dueDate))}</strong> · {String(task.title)}</span><Badge value={String(task.status)} /></div>)}
        {dated.length === 0 ? <Empty title="Nuk ka afate" text="Vendosni një datë kur krijoni detyrën." /> : null}
      </Card>
    </div>
  );
}

export function AuditPage() {
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => api<Row[]>('/api/audit') });
  return (
    <div>
      <PageHeader title="Auditimi" description="Ngjarjet e zyrës. Regjistrimet nuk ndryshohen nga kjo faqe." />
      <Card>{(audit.data ?? []).map((event) => <p key={String(event.id)} className="border-b border-line px-4 py-3 text-sm"><span className="text-muted">{formatDateTime(String(event.createdAt))}</span> · {String(event.summary)}</p>)}{audit.error ? <ErrorNote error={audit.error} /> : null}</Card>
    </div>
  );
}

export function AgingPage() {
  const { companyId } = useSession();
  const report = useQuery({ queryKey: ['company', companyId, 'aging'], enabled: Boolean(companyId), queryFn: () => api<Row>('/api/aging') });
  const buckets = (report.data?.buckets ?? []) as Row[];
  const rows = (report.data?.rows ?? []) as Row[];
  return (
    <div>
      <PageHeader title="Vjetërsimi i të arkëtueshmeve" description={`Llogaritur më ${formatDate(String(report.data?.asOf ?? ''))}. ${String(report.data?.note ?? '')}`} />
      <div className="mb-4 grid gap-3 sm:grid-cols-5">{buckets.map((bucket) => <Card key={String(bucket.key)} className="p-3"><p className="text-xs text-muted">{String(bucket.label)}</p><p className="tabular font-semibold">{formatMoney(String(bucket.amount))}</p><p className="text-xs text-muted">{String(bucket.count)} fatura</p></Card>)}</div>
      <Card>{rows.map((row) => <div key={String(row.id)} className="flex justify-between border-b border-line px-4 py-3 text-sm"><span>{String(row.displayNumber)} · {String(row.customer)} · afati {formatDate(String(row.dueDate))}</span><span>{formatMoney(String(row.outstanding))} · {String(row.bucketLabel)}</span></div>)}</Card>
    </div>
  );
}
