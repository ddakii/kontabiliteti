import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select } from '../components/ui';
import { api, download } from '../lib/api';
import { formatDate, formatMoney, todayInput } from '../lib/format';
import { useSession } from '../lib/session';

type Row = Record<string, unknown>;

export function DashboardPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Row>('/api/dashboard') });
  if (query.isLoading) return <p>Po ngarkohet paneli…</p>;
  if (query.error) return <ErrorNote error={query.error} />;
  const data = query.data ?? {};
  const tasks = (data.tasksByStatus ?? {}) as Record<string, number>;
  const chart = Object.entries(tasks).map(([name, value]) => ({ name, value }));
  const cards = [
    ['Kompanitë', data.companiesTotal],
    ['Aktive', data.activeCompanies],
    ['Dokumente që mungojnë', data.missingDocuments],
    ['Fatura me vonesë', data.overdueInvoices],
    ['Draftet', data.draftInvoices],
    ['Blerje të pashqyrtuara', data.unreviewedPurchases],
  ];
  return (
    <div>
      <PageHeader title="Paneli i zyrës" description="Ngarkesa operative e zyrës. Shifrat financiare të kompanive nuk bashkohen këtu." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value]) => (
          <Card key={String(label)} className="px-4 py-3">
            <p className="text-sm text-muted">{String(label)}</p>
            <p className="tabular mt-1 text-2xl font-semibold">{String(value ?? 0)}</p>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Detyrat sipas statusit</h2>
          {chart.length === 0 ? <Empty title="Nuk ka detyra" text="Detyrat e regjistruara shfaqen këtu." /> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}><XAxis dataKey="name" hide /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="value" fill="#0077b6" radius={[6, 6, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Abonimi</h2>
          <p>{String((data.subscription as Row | null)?.plan ?? 'Pa plan')} · <Badge value={String((data.subscription as Row | null)?.status ?? 'TRIAL')} /></p>
          <p className="mt-2 text-sm text-muted">Kufiri i kompanive: {String((data.subscription as Row | null)?.maxCompanies ?? 'pa kufi')}</p>
        </Card>
      </div>
    </div>
  );
}

export function CompaniesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api<Row[]>('/api/companies?pageSize=100') });
  const municipalities = useQuery({ queryKey: ['municipalities'], queryFn: () => api<string[]>('/api/municipalities') });
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api('/api/companies', {
        method: 'POST',
        body: JSON.stringify({
          legalName: form.get('legalName'),
          tradeName: form.get('tradeName') || undefined,
          businessNumber: form.get('businessNumber') || undefined,
          fiscalNumber: form.get('fiscalNumber') || undefined,
          vatNumber: form.get('vatNumber') || undefined,
          municipality: form.get('municipality') || undefined,
          address: form.get('address') || undefined,
          email: form.get('email') || undefined,
          phone: form.get('phone') || undefined,
          activity: form.get('activity') || undefined,
          vatStatus: form.get('vatStatus'),
          accountingStartDate: form.get('accountingStartDate'),
          fiscalYearStartMonth: 1,
          servicePackage: form.get('servicePackage') || undefined,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      formElement.reset();
      setError(undefined);
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <div>
      <PageHeader title="Kompanitë e klientëve" description="Çdo kompani ka librin, faturat dhe dokumentet e veta." />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted"><tr><th className="px-4 py-3">Emri</th><th>Komuna</th><th>Statusi</th></tr></thead>
            <tbody>
              {(companies.data ?? []).map((company) => (
                <tr key={String(company.id)} className="border-b border-line last:border-0">
                  <td className="px-4 py-3"><Link className="font-medium text-link" to={`/klientet/${company.id}`}>{String(company.legalName)}</Link></td>
                  <td>{String(company.municipality ?? '—')}</td>
                  <td><Badge value={String(company.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {(companies.data ?? []).length === 0 ? <Empty title="Asnjë kompani" text="Shtoni klientin e parë me formularin." /> : null}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Kompani e re</h2>
          <form className="space-y-3" onSubmit={onSubmit}>
            {error ? <ErrorNote error={error} /> : null}
            <Field label="Emri ligjor"><Input name="legalName" required /></Field>
            <Field label="Emri tregtar"><Input name="tradeName" /></Field>
            <Field label="Numri i biznesit"><Input name="businessNumber" /></Field>
            <Field label="Numri fiskal"><Input name="fiscalNumber" /></Field>
            <Field label="Numri i TVSH-së"><Input name="vatNumber" /></Field>
            <Field label="Komuna">
              <Select name="municipality" defaultValue="">{(municipalities.data ?? []).map((name) => <option key={name}>{name}</option>)}</Select>
            </Field>
            <Field label="Adresa"><Input name="address" /></Field>
            <Field label="Email"><Input name="email" type="email" /></Field>
            <Field label="Telefoni"><Input name="phone" /></Field>
            <Field label="Veprimtaria"><Input name="activity" /></Field>
            <Field label="Statusi i TVSH-së">
              <Select name="vatStatus" defaultValue="UNKNOWN"><option value="REGISTERED">I regjistruar</option><option value="NOT_REGISTERED">I paregjistruar</option><option value="EXEMPT">I liruar</option><option value="UNKNOWN">I papërcaktuar</option></Select>
            </Field>
            <Field label="Data e fillimit të kontabilitetit"><Input name="accountingStartDate" type="date" required defaultValue={todayInput()} /></Field>
            <Field label="Paketa e shërbimit"><Input name="servicePackage" /></Field>
            <Button type="submit">Ruaj kompaninë</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function CompanyPage() {
  const { id = '' } = useParams();
  const company = useQuery({ queryKey: ['company-profile', id], queryFn: () => api<Row>(`/api/companies/${id}`) });
  const health = useQuery({ queryKey: ['company-health', id], queryFn: () => api<Row>(`/api/companies/${id}/health`) });
  if (company.isLoading) return <p>Po ngarkohet…</p>;
  if (!company.data) return <ErrorNote error={company.error ?? new Error('Kompania nuk u gjet.')} />;
  const data = company.data;
  return (
    <div>
      <PageHeader title={String(data.legalName)} description="Profili i kompanisë kliente. Regjistrimet financiare i takojnë vetëm kësaj njësie." action={<Badge value={String(data.status)} />} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-sm text-muted">Detyra të hapura</p><p className="text-2xl font-semibold">{String(health.data?.openTasks ?? 0)}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Dokumente që mungojnë</p><p className="text-2xl font-semibold">{String(health.data?.missingDocs ?? 0)}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Fatura me vonesë</p><p className="text-2xl font-semibold">{String(health.data?.overdueInvoices ?? 0)}</p></Card>
      </div>
      <Card className="mt-4 p-4 text-sm">
        <p>Numri fiskal: {String(data.fiscalNumber ?? '—')}</p>
        <p>Numri i biznesit: {String(data.businessNumber ?? '—')}</p>
        <p>TVSH: {String(data.vatNumber ?? '—')} · {String(data.vatStatus)}</p>
        <p>Komuna: {String(data.municipality ?? '—')}</p>
      </Card>
    </div>
  );
}

export function InvoicesPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const invoices = useQuery({ queryKey: ['company', companyId, 'invoices'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/invoices') });
  const customers = useQuery({ queryKey: ['company', companyId, 'customers'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/customers') });
  const rates = useQuery({ queryKey: ['company', companyId, 'tax'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/tax-rates') });
  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await api('/api/customers', { method: 'POST', body: JSON.stringify({ name: form.get('name'), fiscalNumber: form.get('fiscalNumber') || undefined }) });
    formElement.reset();
    await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'customers'] });
  }
  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const draft = await api<Row>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.get('customerId'),
          issueDate: form.get('issueDate'),
          dueDate: form.get('dueDate'),
          lines: [{ description: form.get('description'), quantity: form.get('quantity'), unitPrice: form.get('unitPrice'), taxRateId: form.get('taxRateId') || undefined, vatPercent: '0', treatment: 'EXEMPT' }],
        }),
      });
      if (form.get('finalize') === 'on') await api(`/api/invoices/${draft.id}/finalize`, { method: 'POST', body: '{}' });
      await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'invoices'] });
      setError(undefined);
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <div>
      <PageHeader title="Faturat" description={companyId ? 'Faturat e kompanisë aktive.' : 'Zgjidhni kompaninë.'} action={<Button variant="secondary" onClick={() => download('/api/invoices/export.xlsx', 'faturat.xlsx')}>Excel</Button>} />
      {error ? <div className="mb-3"><ErrorNote error={error} /></div> : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted"><tr><th className="px-4 py-3">Numri</th><th>Data</th><th>Totali</th><th>Statusi</th></tr></thead>
            <tbody>
              {(invoices.data ?? []).map((invoice) => (
                <tr key={String(invoice.id)} className="border-b border-line">
                  <td className="px-4 py-3"><Link className="text-link" to={`/faturat/${invoice.id}`}>{String(invoice.displayNumber ?? 'Draft')}</Link></td>
                  <td>{formatDate(String(invoice.issueDate))}</td>
                  <td className="tabular">{formatMoney(String(invoice.total))}</td>
                  <td><Badge value={String(invoice.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Blerës i ri</h2>
            <form className="space-y-3" onSubmit={createCustomer}>
              <Field label="Emri"><Input name="name" required /></Field>
              <Field label="Numri fiskal"><Input name="fiscalNumber" /></Field>
              <Button type="submit" variant="secondary">Shto</Button>
            </form>
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Faturë</h2>
            <form className="space-y-3" onSubmit={createInvoice}>
              <Field label="Blerësi"><Select name="customerId" required>{(customers.data ?? []).map((customer) => <option key={String(customer.id)} value={String(customer.id)}>{String(customer.name)}</option>)}</Select></Field>
              <Field label="Data"><Input name="issueDate" type="date" defaultValue={todayInput()} required /></Field>
              <Field label="Afati"><Input name="dueDate" type="date" defaultValue={todayInput()} required /></Field>
              <Field label="Përshkrimi"><Input name="description" required /></Field>
              <Field label="Sasia"><Input name="quantity" defaultValue="1" required /></Field>
              <Field label="Çmimi"><Input name="unitPrice" defaultValue="0.00" required /></Field>
              <Field label="Norma e TVSH-së" hint="Normat e pakonfirmuara refuzohen derisa t’i konfirmoni te TVSH.">
                <Select name="taxRateId"><option value="">Pa normë të zgjedhur</option>{(rates.data ?? []).map((rate) => <option key={String(rate.id)} value={String(rate.id)}>{String(rate.code)} · {String(rate.ratePercent)}%</option>)}</Select>
              </Field>
              <label className="flex items-center gap-2 text-sm"><input name="finalize" type="checkbox" /> Finalizo dhe posto</label>
              <Button type="submit">Ruaj</Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const { companyId } = useSession();
  const invoice = useQuery({ queryKey: ['company', companyId, 'invoice', id], queryFn: () => api<Row>(`/api/invoices/${id}`) });
  if (!invoice.data) return invoice.error ? <ErrorNote error={invoice.error} /> : <p>Po ngarkohet…</p>;
  const data = invoice.data;
  const lines = (data.lines as Row[]) ?? [];
  return (
    <div>
      <PageHeader title={String(data.displayNumber ?? 'Draft')} action={<div className="flex gap-2"><Button variant="secondary" onClick={() => download(`/api/invoices/${id}/pdf`, `${data.displayNumber ?? 'fatura'}.pdf`)}>PDF</Button><Link className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-3 text-sm text-ink" to={`/print/fatura/${id}`}>Printo</Link></div>} />
      <Card className="p-4 text-sm">
        <p>Statusi: <Badge value={String(data.status)} /></p>
        <p className="mt-2">Totali: <strong className="tabular">{formatMoney(String(data.total))}</strong></p>
        <p>E paguar: {formatMoney(String(data.amountPaid))} · E kredituar: {formatMoney(String(data.amountCredited))}</p>
        <table className="mt-4 w-full">
          <tbody>
            {lines.map((line) => (
              <tr key={String(line.id)} className="border-t border-line"><td className="py-2">{String(line.description)}</td><td className="tabular text-right">{formatMoney(String(line.lineTotal))}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function PrintInvoicePage() {
  const { id = '' } = useParams();
  const invoice = useQuery({ queryKey: ['print-invoice', id], queryFn: () => api<Row>(`/api/invoices/${id}`) });
  if (!invoice.data) return <p className="p-8">Po ngarkohet fatura…</p>;
  const data = invoice.data;
  const company = (data.company as Row) ?? {};
  const customer = (data.customer as Row) ?? {};
  const lines = (data.lines as Row[]) ?? [];
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-ink">
      <div className="no-print mb-4"><Button onClick={() => window.print()}>Printo</Button></div>
      <header className="flex justify-between border-b border-line pb-4">
        <div><p className="text-xs uppercase tracking-wider text-muted">Faturë</p><h1 className="text-2xl font-semibold">{String(data.displayNumber ?? 'Draft')}</h1></div>
        <div className="text-right text-sm"><p className="font-semibold">{String(company.legalName ?? '')}</p><p>{String(company.municipality ?? '')}</p><p>Numri fiskal: {String(company.fiscalNumber ?? '—')}</p></div>
      </header>
      <p className="mt-4 text-sm">Blerësi: <strong>{String(customer.name ?? '—')}</strong></p>
      <p className="text-sm">Data: {formatDate(String(data.issueDate))} · Afati: {formatDate(String(data.dueDate))}</p>
      <table className="mt-6 w-full text-sm">
        <thead><tr className="border-b border-line text-left"><th className="py-2">Përshkrimi</th><th>Sasia</th><th>Totali</th></tr></thead>
        <tbody>{lines.map((line) => <tr key={String(line.id)} className="border-b border-line"><td className="py-2">{String(line.description)}</td><td>{String(line.quantity)}</td><td className="tabular">{formatMoney(String(line.lineTotal))}</td></tr>)}</tbody>
      </table>
      <p className="mt-4 text-right text-lg font-semibold tabular">Për t'u paguar {formatMoney(String(data.total))}</p>
    </article>
  );
}

export function SimpleListPage({ title, path, columns }: { title: string; path: string; columns: [string, string][] }) {
  const { companyId } = useSession();
  const query = useQuery({ queryKey: ['company', companyId, path], enabled: Boolean(companyId), queryFn: () => api<Row[]>(path) });
  return (
    <div>
      <PageHeader title={title} />
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-muted"><tr>{columns.map(([label]) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
          <tbody>
            {(query.data ?? []).map((row) => (
              <tr key={String(row.id)} className="border-b border-line">{columns.map(([label, key]) => <td key={label} className="px-4 py-3">{key === 'status' ? <Badge value={String(row[key] ?? '')} /> : String(row[key] ?? '—')}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {query.error ? <ErrorNote error={query.error} /> : null}
      </Card>
    </div>
  );
}

export function PurchasesPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const purchases = useQuery({ queryKey: ['company', companyId, 'purchases'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/purchases') });
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const supplier = await api<Row>('/api/suppliers', { method: 'POST', body: JSON.stringify({ name: form.get('supplier') }) });
      const purchase = await api<Row>('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({ supplierId: (supplier as { purchase?: { id: string } }).purchase ? undefined : supplier.id, supplierInvoiceNumber: form.get('number'), issueDate: form.get('issueDate'), dueDate: form.get('dueDate'), lines: [{ description: form.get('description'), quantity: '1', unitPrice: form.get('amount'), vatPercent: '0', treatment: 'EXEMPT' }] }),
      });
      const id = (purchase.purchase as Row | undefined)?.id ?? purchase.id;
      if (form.get('post') === 'on' && id) await api(`/api/purchases/${id}/post`, { method: 'POST', body: '{}' });
      await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchases'] });
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <div>
      <PageHeader title="Blerjet" description="Shqyrtimi bëhet te fatura e hapur, me butonin Shqyrto. Postimi në libër është hapi pas shqyrtimit." />
      {error ? <ErrorNote error={error} /> : null}
      {((purchases.data ?? []).filter((row) => row.status === 'DRAFT' || row.status === 'IN_REVIEW')).length > 0 ? (
        <Card className="mb-4 p-4">
          <h2 className="text-sm font-semibold text-sidebar">Këtu shqyrtohen blerjet</h2>
          <div className="mt-3 divide-y divide-line">
            {(purchases.data ?? []).filter((row) => row.status === 'DRAFT' || row.status === 'IN_REVIEW').map((row) => (
              <div key={String(row.id)} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">{String(row.supplierInvoiceNumber ?? 'Pa numër')} · {String((row.supplier as Row | undefined)?.name ?? '—')} · <Badge value={String(row.status)} /></span>
                <Link className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white" to={`/blerjet/${row.id}`}>{row.status === 'DRAFT' ? 'Shqyrto' : 'Posto'}</Link>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-3" onSubmit={onSubmit}>
          <Field label="Furnitori"><Input name="supplier" required /></Field>
          <Field label="Numri i faturës"><Input name="number" required /></Field>
          <Field label="Shuma"><Input name="amount" required /></Field>
          <Field label="Përshkrimi"><Input name="description" required /></Field>
          <Field label="Data"><Input name="issueDate" type="date" defaultValue={todayInput()} required /></Field>
          <Field label="Afati"><Input name="dueDate" type="date" defaultValue={todayInput()} required /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="post" /> Posto</label>
          <Button type="submit">Regjistro</Button>
        </form>
      </Card>
      <Card>
        {(purchases.data ?? []).length === 0 ? <Empty title="Nuk ka blerje" text="Fatura e furnitorit shfaqet këtu dhe hapet si dokument." /> : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted"><tr><th className="px-4 py-3">Numri</th><th>Furnitori</th><th>Data</th><th>Totali</th><th>Statusi</th><th></th></tr></thead>
            <tbody>
              {(purchases.data ?? []).map((row) => {
                const supplier = (row.supplier as Row | undefined)?.name;
                const status = String(row.status);
                return (
                  <tr key={String(row.id)} className="border-b border-line">
                    <td className="px-4 py-3"><Link className="text-link" to={`/blerjet/${row.id}`}>{String(row.supplierInvoiceNumber ?? 'Pa numër')}</Link></td>
                    <td>{String(supplier ?? '—')}</td>
                    <td>{formatDate(String(row.issueDate))}</td>
                    <td className="tabular">{formatMoney(String(row.total))}</td>
                    <td><Badge value={status} /></td>
                    <td className="px-4 py-3 text-right">{status === 'DRAFT' || status === 'IN_REVIEW' ? <Link className="font-medium text-link" to={`/blerjet/${row.id}`}>{status === 'DRAFT' ? 'Shqyrto' : 'Posto'}</Link> : <Link className="text-link" to={`/blerjet/${row.id}`}>Hap</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function PurchaseDetailPage() {
  const { id = '' } = useParams();
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const purchase = useQuery({
    queryKey: ['company', companyId, 'purchase', id],
    queryFn: () => api<Row>(`/api/purchases/${id}`),
  });
  async function act(path: string) {
    try {
      await api(path, { method: 'POST', body: '{}' });
      await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchase', id] });
      await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'purchases'] });
      await queryClient.invalidateQueries({ queryKey: ['work-queue'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['work-queue'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setError(undefined);
    } catch (caught) {
      setError(caught);
    }
  }
  if (!purchase.data) return purchase.error ? <ErrorNote error={purchase.error} /> : <p>Po ngarkohet fatura e blerjes…</p>;
  const data = purchase.data;
  const supplier = (data.supplier as Row | undefined) ?? {};
  const lines = (data.lines as Row[]) ?? [];
  const status = String(data.status);
  const open = status === 'DRAFT' || status === 'IN_REVIEW';
  return (
    <div>
      <PageHeader
        title={String(data.supplierInvoiceNumber ?? 'Faturë blerjeje')}
        description={status === 'DRAFT' ? 'Shqyrtimi bëhet këtu. Nuk e poston ende në libër.' : status === 'IN_REVIEW' ? 'Është shqyrtuar. Postimi në libër bëhet me butonin Posto.' : 'Fatura e furnitorit.'}
        action={
          <div className="flex flex-wrap gap-2">
            {status === 'DRAFT' ? <Button type="button" onClick={() => act(`/api/purchases/${id}/review`)}>Shqyrto</Button> : null}
            {open ? <Button type="button" variant={status === 'DRAFT' ? 'secondary' : 'primary'} onClick={() => act(`/api/purchases/${id}/post`)}>Posto në libër</Button> : null}
            <Link className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-3 text-sm text-ink" to={`/print/blerje/${id}`}>Printo</Link>
          </div>
        }
      />
      {error ? <div className="mb-3"><ErrorNote error={error} /></div> : null}
      <Card className="p-4 text-sm">
        <p>Furnitori: <strong>{String(supplier.name ?? '—')}</strong></p>
        <p className="mt-1">Statusi: <Badge value={status} /></p>
        <p className="mt-1">Data: {formatDate(String(data.issueDate))} · Afati: {formatDate(String(data.dueDate))}</p>
        <table className="mt-4 w-full">
          <thead><tr className="border-b border-line text-left text-muted"><th className="py-2">Përshkrimi</th><th>Sasia</th><th>Çmimi</th><th>TVSH</th><th className="text-right">Totali</th></tr></thead>
          <tbody>
            {lines.map((line) => (
              <tr key={String(line.id)} className="border-t border-line">
                <td className="py-2">{String(line.description)}</td>
                <td>{String(line.quantity)}</td>
                <td className="tabular">{formatMoney(String(line.unitPrice))}</td>
                <td className="tabular">{formatMoney(String(line.vatAmount))}</td>
                <td className="tabular text-right">{formatMoney(String(line.lineTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4">Nëntotali: {formatMoney(String(data.subtotal))} · TVSH: {formatMoney(String(data.vatTotal))}</p>
        <p className="text-lg font-semibold">Totali: <span className="tabular">{formatMoney(String(data.total))}</span></p>
        {status === 'DRAFT' ? <p className="mt-4 text-muted">Butoni Shqyrto është lart. Ai e shënon faturën pa e postuar në libër.</p> : status === 'IN_REVIEW' ? <p className="mt-4 text-muted">Shqyrtimi është kryer. Butoni Posto në libër, lart, e regjistron.</p> : null}
      </Card>
    </div>
  );
}

export function PrintPurchasePage() {
  const { id = '' } = useParams();
  const purchase = useQuery({ queryKey: ['print-purchase', id], queryFn: () => api<Row>(`/api/purchases/${id}`) });
  if (!purchase.data) return <p className="p-8">Po ngarkohet fatura e blerjes…</p>;
  const data = purchase.data;
  const supplier = (data.supplier as Row | undefined) ?? {};
  const lines = (data.lines as Row[]) ?? [];
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-ink">
      <div className="no-print mb-4"><Button onClick={() => window.print()}>Printo</Button></div>
      <header className="flex justify-between border-b border-line pb-4">
        <div><p className="text-xs uppercase tracking-wider text-muted">Faturë blerjeje</p><h1 className="text-2xl font-semibold">{String(data.supplierInvoiceNumber ?? 'Pa numër')}</h1></div>
        <div className="text-right text-sm"><p className="font-semibold">{String(supplier.name ?? '—')}</p><p>Statusi: {String(data.status)}</p></div>
      </header>
      <p className="mt-4 text-sm">Data: {formatDate(String(data.issueDate))} · Afati: {formatDate(String(data.dueDate))}</p>
      <table className="mt-6 w-full text-sm">
        <thead><tr className="border-b border-line text-left"><th className="py-2">Përshkrimi</th><th>Sasia</th><th>Totali</th></tr></thead>
        <tbody>{lines.map((line) => <tr key={String(line.id)} className="border-b border-line"><td className="py-2">{String(line.description)}</td><td>{String(line.quantity)}</td><td className="tabular">{formatMoney(String(line.lineTotal))}</td></tr>)}</tbody>
      </table>
      <p className="mt-4 text-right">TVSH {formatMoney(String(data.vatTotal))}</p>
      <p className="text-right text-lg font-semibold tabular">Totali {formatMoney(String(data.total))}</p>
    </article>
  );
}

export function EmployeesPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const employees = useQuery({
    queryKey: ['company', companyId, 'employees'],
    enabled: Boolean(companyId),
    queryFn: () => api<Row[]>('/api/employees'),
  });
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const personalNumber = String(form.get('personalNumber') ?? '').trim();
    const jobTitle = String(form.get('jobTitle') ?? '').trim();
    const hiredOn = String(form.get('hiredOn') ?? '').trim();
    try {
      await api('/api/employees', {
        method: 'POST',
        body: JSON.stringify({
          firstName: form.get('firstName'),
          lastName: form.get('lastName'),
          ...(personalNumber ? { personalNumber } : {}),
          ...(jobTitle ? { jobTitle } : {}),
          ...(hiredOn ? { hiredOn } : {}),
          grossSalary: form.get('grossSalary'),
        }),
      });
      formElement.reset();
      setError(undefined);
      await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'employees'] });
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <div>
      <PageHeader title="Punëtorët" description="Regjistri i punëtorëve të kompanisë aktive. Paga bruto ruhet siç e shkruani; kjo faqe nuk llogarit tatimin dhe nuk dërgon listëpagesë." />
      {error ? <div className="mb-3"><ErrorNote error={error} /></div> : null}
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-3" onSubmit={onSubmit}>
          <Field label="Emri"><Input name="firstName" required /></Field>
          <Field label="Mbiemri"><Input name="lastName" required /></Field>
          <Field label="Numri personal"><Input name="personalNumber" /></Field>
          <Field label="Pozita"><Input name="jobTitle" /></Field>
          <Field label="Paga bruto"><Input name="grossSalary" required inputMode="decimal" /></Field>
          <Field label="Data e punësimit"><Input name="hiredOn" type="date" defaultValue={todayInput()} /></Field>
          <Button type="submit">Shto punëtorin</Button>
        </form>
      </Card>
      <Card>
        {!companyId ? <Empty title="Zgjidhni kompaninë" text="Punëtorët i takojnë kompanisë aktive." /> : employees.isLoading ? <p className="p-4 text-sm">Po ngarkohet lista…</p> : employees.error ? <div className="p-4"><ErrorNote error={employees.error} /></div> : (employees.data ?? []).length === 0 ? <Empty title="Nuk ka punëtorë" text="Shtoni punëtorin e parë me formularin sipër." /> : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted"><tr><th className="px-4 py-3">Punëtori</th><th>Pozita</th><th>Numri personal</th><th>Paga bruto</th><th>Punësimi</th><th>Statusi</th></tr></thead>
            <tbody>
              {(employees.data ?? []).map((row) => (
                <tr key={String(row.id)} className="border-b border-line">
                  <td className="px-4 py-3 font-medium">{String(row.firstName)} {String(row.lastName)}</td>
                  <td>{String(row.jobTitle ?? '—')}</td>
                  <td>{String(row.personalNumber ?? '—')}</td>
                  <td className="tabular">{formatMoney(String(row.grossSalary))}</td>
                  <td>{formatDate(row.hiredOn ? String(row.hiredOn) : null)}</td>
                  <td>{row.isActive === false ? 'Jo aktiv' : 'Aktiv'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function PaymentsPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const query = useQuery({ queryKey: ['company', companyId, 'payments'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/payments') });
  const invoices = useQuery({ queryKey: ['company', companyId, 'invoices'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/invoices') });
  const banks = useQuery({ queryKey: ['company', companyId, 'banks'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/bank-accounts') });
  const payable = (invoices.data ?? []).filter((invoice) => ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(String(invoice.status)));
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const invoice = payable.find((item) => item.id === form.get('invoiceId'));
    const amount = String(form.get('amount') || invoice?.amountDue || '0');
    try {
      await api('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          direction: 'INCOMING',
          amount,
          date: form.get('date'),
          method: 'CASH',
          bankAccountId: form.get('bankAccountId'),
          customerId: invoice?.customerId,
          reference: form.get('reference') || undefined,
          allocations: [{ invoiceId: form.get('invoiceId'), amount }],
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['company', companyId] });
      setError(undefined);
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <div>
      <PageHeader title="Pagesat" description="Arkëtimet dhe pagesat e kompanisë aktive, të lidhura me dokumentin dhe regjistrimin." />
      {error ? <div className="mb-3"><ErrorNote error={error} /></div> : null}
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit}>
          <Field label="Fatura">
            <Select name="invoiceId" required>
              {payable.map((invoice) => (
                <option key={String(invoice.id)} value={String(invoice.id)}>
                  {String(invoice.displayNumber ?? 'Draft')} · {formatMoney(String(invoice.amountDue ?? invoice.total))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Llogaria">
            <Select name="bankAccountId" required>
              {(banks.data ?? []).map((bank) => <option key={String(bank.id)} value={String(bank.id)}>{String(bank.name)}</option>)}
            </Select>
          </Field>
          <Field label="Shuma"><Input name="amount" placeholder="Lëreni bosh për shumën e mbetur" /></Field>
          <Field label="Data"><Input name="date" type="date" defaultValue={todayInput()} required /></Field>
          <Field label="Referenca"><Input name="reference" /></Field>
          <div className="flex items-end"><Button type="submit">Regjistro arkëtimin</Button></div>
        </form>
      </Card>
      <Card>
        <table className="w-full text-sm"><tbody>{(query.data ?? []).map((row) => <tr key={String(row.id)} className="border-b border-line"><td className="px-4 py-3">{formatDate(String(row.date))}</td><td>{String(row.direction) === 'INCOMING' ? 'Arkëtim' : 'Pagesë'}</td><td className="tabular">{formatMoney(String(row.amount))}</td><td>{String(row.reference ?? '')}</td></tr>)}</tbody></table>
        {(query.data ?? []).length === 0 ? <Empty title="Nuk ka pagesa" text="Regjistroni një arkëtim pasi fatura të jetë finalizuar." /> : null}
      </Card>
    </div>
  );
}

export function AccountingPage() {
  const { companyId } = useSession();
  const accounts = useQuery({ queryKey: ['company', companyId, 'accounts'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/accounts') });
  const journals = useQuery({ queryKey: ['company', companyId, 'journals'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/journal-entries') });
  const periods = useQuery({ queryKey: ['company', companyId, 'periods'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/periods') });
  const trial = useQuery({ queryKey: ['company', companyId, 'trial'], enabled: Boolean(companyId), queryFn: () => api<Row>('/api/reports/trial-balance') });
  return (
    <div>
      <PageHeader title="Kontabiliteti" description="Plani kontabël fillestar është i konfigurueshëm dhe nuk është plan zyrtar i detyrueshëm." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4"><h2 className="mb-2 font-semibold">Bilanci i provës</h2><p className="text-sm">Debi {formatMoney(String(trial.data?.debit ?? 0))} · Kredi {formatMoney(String(trial.data?.credit ?? 0))}</p><p className="text-sm">{trial.data?.balanced ? 'I baraspeshuar' : 'Kontrolloni regjistrimet'}</p></Card>
        <Card className="p-4"><h2 className="mb-2 font-semibold">Periudhat</h2>{(periods.data ?? []).slice(0, 6).map((period) => <p key={String(period.id)} className="text-sm">{String(period.name)} · <Badge value={String(period.status)} /></p>)}</Card>
      </div>
      <Card className="mt-4">
        <table className="w-full text-sm"><tbody>{(accounts.data ?? []).map((account) => <tr key={String(account.id)} className="border-b border-line"><td className="px-4 py-2 font-mono">{String(account.code)}</td><td>{String(account.name)}</td><td>{String(account.type)}</td></tr>)}</tbody></table>
      </Card>
      <Card className="mt-4 p-4 text-sm text-muted">Regjistrime në libër: {(journals.data ?? []).length}</Card>
    </div>
  );
}

export function TaxPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const rates = useQuery({ queryKey: ['company', companyId, 'tax'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/tax-rates') });
  const summary = useQuery({ queryKey: ['company', companyId, 'vat'], enabled: Boolean(companyId), queryFn: () => api<Row>('/api/tax/summary') });
  return (
    <div>
      <PageHeader title="TVSH dhe tatimet" description="Përgatitje e brendshme. Nuk është deklaratë e dorëzuar te ATK." />
      <Card className="mb-4 p-4 text-sm">{String(summary.data?.disclaimer ?? '')}<p className="mt-2">Pozicioni: {formatMoney(String(summary.data?.vatPosition ?? 0))}</p></Card>
      <Card>
        {(rates.data ?? []).map((rate) => (
          <div key={String(rate.id)} className="flex items-center justify-between border-b border-line px-4 py-3 text-sm">
            <div><p className="font-medium">{String(rate.name)}</p><p className="text-muted">{String(rate.sourceNote)}</p></div>
            {rate.userConfirmedAt ? <Badge value="REVIEWED" /> : <Button variant="secondary" onClick={async () => { await api(`/api/tax-rates/${rate.id}/confirm`, { method: 'POST', body: JSON.stringify({ note: 'E konfirmoj pas verifikimit me burimin zyrtar aktual.' }) }); await queryClient.invalidateQueries({ queryKey: ['company', companyId, 'tax'] }); }}>Konfirmo</Button>}
          </div>
        ))}
      </Card>
    </div>
  );
}

function ReportView({ data }: { data: Row }) {
  const groups = ['revenue', 'expenses', 'assets', 'liabilities', 'equity', 'rows', 'accounts', 'lines']
    .map((key) => [key, data[key]] as const)
    .filter((entry): entry is [string, Row[]] => Array.isArray(entry[1]));
  const totals = [
    ['Të hyrat', data.revenueTotal],
    ['Shpenzimet', data.expenseTotal],
    ['Rezultati', data.profit],
    ['Debi', data.debit],
    ['Kredi', data.credit],
    ['Pozicioni i TVSH-së', data.vatPosition],
  ].filter((entry): entry is [string, unknown] => entry[1] !== undefined);
  const labels: Record<string, string> = {
    revenue: 'Të hyrat',
    expenses: 'Shpenzimet',
    assets: 'Aktivet',
    liabilities: 'Detyrimet',
    equity: 'Ekuiteti',
    rows: 'Rreshtat',
    accounts: 'Llogaritë',
    lines: 'Lëvizjet',
  };
  return (
    <div className="space-y-4">
      <p className="font-medium">{String(data.company ?? '')}</p>
      {totals.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {totals.map(([label, value]) => (
            <div key={String(label)}>
              <p className="text-muted">{label}</p>
              <p className="tabular text-lg font-semibold">{formatMoney(String(value))}</p>
            </div>
          ))}
        </div>
      ) : null}
      {groups.map(([key, rows]) => (
        <div key={key}>
          <p className="mb-2 font-medium">{labels[key]}</p>
          <table className="w-full">
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id ?? row.accountId ?? index)} className="border-t border-line">
                  <td className="py-2">{String(row.code ?? '')} {String(row.name ?? row.displayNumber ?? row.description ?? '')}</td>
                  <td className="tabular py-2 text-right">{formatMoney(String(row.balance ?? row.amountDue ?? row.total ?? row.amount ?? '0'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function ReportsPage() {
  const [params] = useSearchParams();
  const { companyId } = useSession();
  const type = params.get('type') ?? 'income-statement';
  const report = useQuery({ queryKey: ['company', companyId, 'report', type], enabled: Boolean(companyId), queryFn: () => api<Row>(`/api/reports/${type}`) });
  const links = [
    ['income-statement', 'Pasqyra e të ardhurave'],
    ['balance-sheet', 'Bilanci i gjendjes'],
    ['cash-flow', 'Rrjedha e parasë'],
    ['trial-balance', 'Bilanci i provës'],
    ['ledger', 'Libri kryesor'],
    ['receivables', 'Llogaritë e arkëtueshme'],
    ['payables', 'Llogaritë e pagueshme'],
    ['vat', 'TVSH'],
  ];
  return (
    <div>
      <PageHeader title="Raportet" description="Nga regjistrimet e postuara të kompanisë aktive." action={<Button variant="secondary" onClick={() => download(`/api/reports/${type}/export.xlsx`, `${type}.xlsx`)}>Excel</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">{links.map(([key, label]) => <Link key={key} className="chip" to={`/raportet?type=${key}`}>{label}</Link>)}<Link className="chip" to="/vjetersimi">Vjetërsimi</Link></div>
      <Card className="p-4 text-sm">
        {report.isLoading ? <p>Po përgatitet raporti…</p> : null}
        {report.error ? <ErrorNote error={report.error} /> : null}
        {report.data ? <ReportView data={report.data} /> : null}
      </Card>
    </div>
  );
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<Row[]>('/api/tasks') });
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: form.get('title'), dueDate: form.get('dueDate') || undefined, priority: 'NORMAL' }) });
    formElement.reset();
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }
  return (
    <div>
      <PageHeader title="Detyrat" />
      <Card className="mb-4 p-4"><form className="flex flex-wrap gap-3" onSubmit={onSubmit}><Input name="title" placeholder="Titulli" required /><Input name="dueDate" type="date" /><Button type="submit">Shto</Button></form></Card>
      <Card>{(tasks.data ?? []).map((task) => <div key={String(task.id)} className="flex items-center justify-between border-b border-line px-4 py-3 text-sm"><span>{String(task.title)}</span><Badge value={String(task.status)} /></div>)}</Card>
    </div>
  );
}

export function DocumentsPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const documents = useQuery({ queryKey: ['company', companyId, 'documents'], enabled: Boolean(companyId), queryFn: () => api<Row[]>('/api/documents') });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.set('file', file);
      body.set('category', 'OTHER');
      await api('/api/documents', { method: 'POST', body });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['company', companyId, 'documents'] }),
  });
  return (
    <div>
      <PageHeader title="Dokumentet" description="Skedarët ruhen privatisht dhe shkarkohen vetëm pas autorizimit." />
      <input className="mb-4 text-sm" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} />
      {upload.error ? <ErrorNote error={upload.error} /> : null}
      <Card>{(documents.data ?? []).map((document) => <div key={String(document.id)} className="flex justify-between border-b border-line px-4 py-3 text-sm"><span>{String(document.originalName)}</span><Badge value={String(document.status)} /></div>)}</Card>
    </div>
  );
}

export function TeamPage() {
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Row[]>('/api/members') });
  const [token, setToken] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api<{ devInvitationToken?: string }>('/api/invitations', { method: 'POST', body: JSON.stringify({ email: form.get('email'), roleKey: form.get('roleKey'), kind: 'FIRM' }) });
    setToken(result.devInvitationToken ?? '');
  }
  return (
    <div>
      <PageHeader title="Ekipi" />
      <Card className="mb-4 p-4"><form className="flex flex-wrap gap-3" onSubmit={onSubmit}><Input name="email" type="email" required placeholder="Email" /><Select name="roleKey" defaultValue="ACCOUNTANT"><option value="SENIOR_ACCOUNTANT">Kontabilist i lartë</option><option value="ACCOUNTANT">Kontabilist</option><option value="ASSISTANT">Asistent</option><option value="AUDITOR">Auditor</option></Select><Button type="submit">Fto</Button></form>{token ? <p className="mt-2 text-sm">Kodi i ftesës për zhvillim: {token}</p> : null}</Card>
      <Card>{(members.data ?? []).map((member) => { const user = member.user as Row; const role = member.role as Row; return <div key={String(member.id)} className="border-b border-line px-4 py-3 text-sm">{String(user?.name)} · {String(role?.name)}</div>; })}</Card>
    </div>
  );
}

export function SubscriptionPage() {
  const subscription = useQuery({ queryKey: ['subscription'], queryFn: () => api<Row>('/api/subscription') });
  const plan = subscription.data?.plan as Row | undefined;
  return (
    <div>
      <PageHeader title="Abonimi" description="Aktivizimi me pagesë bëhet nga administratori pasi të merret pagesa reale. Programi nuk e shënon faturën të paguar vetë." />
      <Card className="p-4 text-sm">
        <p>Plani: {String(plan?.name ?? '—')}</p>
        <p>Statusi: {String(subscription.data?.status ?? '—')}</p>
        <p>Vetëm lexim: {subscription.data?.readOnly ? 'Po' : 'Jo'}</p>
        <Button className="mt-3" variant="secondary" onClick={() => api('/api/subscription/cancel', { method: 'POST', body: '{}' })}>Kërko anulim</Button>
      </Card>
    </div>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const results = useQuery({ queryKey: ['search', q], enabled: q.length > 1, queryFn: () => api<Record<string, Row[]>>(`/api/search?q=${encodeURIComponent(q)}`) });
  return (
    <div>
      <PageHeader title={`Kërkimi: ${q}`} />
      <Card className="p-4 text-sm">{Object.entries(results.data ?? {}).map(([key, rows]) => <div key={key} className="mb-3"><p className="font-semibold">{key}</p>{rows.map((row) => <p key={String(row.id)}>{String(row.legalName ?? row.displayNumber ?? row.name ?? row.title ?? row.originalName ?? row.reference ?? row.id)}</p>)}</div>)}</Card>
    </div>
  );
}

export function PortalPage() {
  const companies = useQuery({ queryKey: ['portal-companies'], queryFn: () => api<Row[]>('/api/portal/companies') });
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Portali i klientit" description="Shikoni vetëm kompaninë tuaj dhe dokumentet e ndara." />
      <Card>{(companies.data ?? []).map((row) => { const company = row.company as Row; return <p key={String(row.id)} className="border-b border-line px-4 py-3">{String(company?.legalName)}</p>; })}</Card>
    </div>
  );
}

export function PlatformPage() {
  const metrics = useQuery({ queryKey: ['platform-metrics'], queryFn: () => api<Row>('/api/platform/metrics') });
  const firms = useQuery({ queryKey: ['platform-firms'], queryFn: () => api<Row[]>('/api/platform/firms') });
  return (
    <div>
      <PageHeader title="Administrimi i platformës" description="Metrika operative të SaaS-it, jo raporte financiare të klientëve." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {Object.entries(metrics.data ?? {}).map(([key, value]) => <Card key={key} className="p-4"><p className="text-sm text-muted">{key}</p><p className="text-2xl font-semibold">{String(value)}</p></Card>)}
      </div>
      <Card>{(firms.data ?? []).map((firm) => <div key={String(firm.id)} className="flex items-center justify-between border-b border-line px-4 py-3 text-sm"><span>{String(firm.legalName)}</span><Badge value={String(firm.status)} /></div>)}</Card>
    </div>
  );
}
