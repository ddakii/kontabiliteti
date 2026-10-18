import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Skeleton, Tabs } from '../components/ui';
import { api, download } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import { useSession } from '../lib/session';

type Row = Record<string, unknown>;

const paymentLabels: Record<string, string> = {
  CASH: 'Para në dorë',
  CREDIT_CARD: 'Kartë',
  VOUCHER: 'Kupon',
  CHEQUE: 'Çek',
  CRYPTO: 'Kriptovalutë',
  OTHER: 'Tjetër',
};

export function FiscalPage() {
  const { companyId } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const overview = useQuery({
    queryKey: ['company', companyId, 'fiscal'],
    enabled: Boolean(companyId),
    queryFn: () => api<Row>('/api/fiscal'),
  });
  const invoices = useQuery({
    queryKey: ['company', companyId, 'fiscal-invoices'],
    enabled: Boolean(companyId) && tab === 'invoices',
    queryFn: () => api<Row[]>('/api/fiscal/invoices'),
  });
  const history = useQuery({
    queryKey: ['company', companyId, 'fiscal-history', query, status],
    enabled: Boolean(companyId) && (tab === 'history' || tab === 'detail'),
    queryFn: () => api<Row[]>(`/api/fiscal/receipts?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}`),
  });
  const detail = useQuery({
    queryKey: ['company', companyId, 'fiscal-receipt', selected],
    enabled: Boolean(companyId && selected),
    queryFn: () => api<Row>(`/api/fiscal/receipts/${selected}`),
  });

  function refresh() {
    setMessage('');
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['company', companyId, 'fiscal'] }),
      queryClient.invalidateQueries({ queryKey: ['company', companyId, 'fiscal-invoices'] }),
      queryClient.invalidateQueries({ queryKey: ['company', companyId, 'fiscal-history'] }),
      queryClient.invalidateQueries({ queryKey: ['company', companyId, 'fiscal-receipt', selected] }),
    ]);
  }

  if (!companyId) return <Empty title="Zgjidhni kompaninë" text="Fiskalizimi i takon kompanisë aktive, jo zyrës në tërësi." />;
  if (overview.isLoading) return <Skeleton className="h-40" />;
  if (overview.error) return <ErrorNote error={overview.error} />;
  const data = overview.data ?? {};
  const steps = (data.steps ?? []) as Row[];
  const branches = (data.branches ?? []) as Row[];
  const terminals = branches.flatMap((branch) => ((branch.terminals ?? []) as Row[]).map((terminal): Row => ({ ...terminal, branchId: branch.id, label: `Dega ${String(branch.branchNumber)} · POS ${String(terminal.posNumber)}` })));
  const readyTerminals = terminals.filter((terminal) => terminal.hasCertificate);

  return (
    <div>
      <PageHeader
        title="Fiskalizimi ATK"
        description="Konfigurimi, kuponët dhe historiku i kësaj kompanie. Programi nuk është i certifikuar nga ATK dhe nuk e shënon faturën të fiskalizuar pa numër transaksioni."
        action={<span className="rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-sidebar">{data.environment === 'PRODUCTION' ? 'Produksion' : 'Test'}</span>}
      />
      <p className="-mt-3 mb-4 text-sm font-medium">{String(data.label ?? 'Konfigurimi nuk ka përfunduar')}</p>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'Përmbledhje' },
          { id: 'setup', label: 'Konfigurimi' },
          { id: 'invoices', label: 'Faturat për fiskalizim' },
          { id: 'history', label: 'Historiku' },
          { id: 'detail', label: 'Detajet' },
          { id: 'check', label: 'Testimi' },
        ]}
      />
      {message ? <p className="mb-3 text-sm text-muted">{message}</p> : null}
      {tab === 'overview' ? <Overview data={data} steps={steps} branches={branches} /> : null}
      {tab === 'setup' ? <Setup data={data} onDone={refresh} onMessage={setMessage} /> : null}
      {tab === 'invoices' ? (
        <Invoices
          rows={invoices.data ?? []}
          loading={invoices.isLoading}
          error={invoices.error}
          terminals={readyTerminals}
          ready={Boolean(data.ready)}
          onDone={async (id) => { setSelected(id); setTab('detail'); await refresh(); }}
        />
      ) : null}
      {tab === 'history' ? (
        <History
          rows={history.data ?? []}
          query={query}
          status={status}
          onQuery={setQuery}
          onStatus={setStatus}
          onOpen={(id) => { setSelected(id); setTab('detail'); }}
        />
      ) : null}
      {tab === 'detail' ? <Detail row={detail.data} error={detail.error} onDone={refresh} onMessage={setMessage} /> : null}
      {tab === 'check' ? <Check ready={Boolean(data.ready)} note={String(data.connectionNote ?? '')} onDone={refresh} onMessage={setMessage} /> : null}
    </div>
  );
}

function Overview({ data, steps, branches }: { data: Row; steps: Row[]; branches: Row[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 text-sm">
        <h2 className="mb-2 font-semibold">Gjendja</h2>
        <p>Mjedisi: {data.environment === 'PRODUCTION' ? 'Produksion' : 'Test'}</p>
        <p>NUI: {String(data.nui ?? '—')}</p>
        <p>Numri i aplikacionit: {String(data.applicationId ?? '—')}</p>
        <p>Numri i fiskalizimit: {data.hasFiscalizationNo ? 'I ruajtur, i fshehur' : 'Mungon'}</p>
        <p>Emri nga ATK: {String(data.businessName ?? '—')}</p>
        <ul className="mt-3 space-y-1">
          {steps.map((step) => <li key={String(step.code)}>{step.done ? '✓' : '○'} {String(step.label)}</li>)}
        </ul>
      </Card>
      <Card className="p-4 text-sm">
        <h2 className="mb-2 font-semibold">Degët dhe POS-et</h2>
        {branches.length === 0 ? <p className="text-muted">Ende pa degë. Shtoni te Konfigurimi.</p> : branches.map((branch) => (
          <div key={String(branch.id)} className="border-t border-line py-2">
            <p className="font-medium">Dega {String(branch.branchNumber)} · {String(branch.location)}</p>
            {((branch.terminals ?? []) as Row[]).map((terminal) => (
              <p key={String(terminal.id)} className="text-muted">POS {String(terminal.posNumber)} · {terminal.hasCertificate ? 'Certifikata është konfiguruar' : 'Pa certifikatë'}</p>
            ))}
          </div>
        ))}
        <p className="mt-3 text-xs text-muted">{String(data.disclaimer ?? 'NUI dhe numri i fiskalizimit merren nga ATK dhe EDI. Çelësi privat nuk del nga serveri.')}</p>
        <h3 className="mb-2 mt-4 font-semibold">Aktiviteti i fundit</h3>
        {((data.recent ?? []) as Row[]).length === 0 ? <p className="text-muted">Ende pa kuponë.</p> : ((data.recent ?? []) as Row[]).map((row) => (
          <p key={String(row.id)} className="border-t border-line py-2">Kuponi {String(row.couponId)} · {formatMoney(String(row.total ?? '0'))} · <Badge value={String(row.status)} /></p>
        ))}
      </Card>
    </div>
  );
}

function Setup({ data, onDone, onMessage }: { data: Row; onDone: () => Promise<unknown>; onMessage: (value: string) => void }) {
  const [environment, setEnvironment] = useState(String(data.environment ?? 'TEST'));
  const [confirm, setConfirm] = useState(false);
  const branches = (data.branches ?? []) as Row[];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/api/fiscal/settings', { method: 'PUT', body: JSON.stringify({ ...body, confirmProduction: confirm }) });
      await onDone();
      onMessage('Të dhënat u ruajtën.');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Ruajtja dështoi.');
    }
  }
  async function addBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/fiscal/branches', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset();
      await onDone();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Dega nuk u shtua.');
    }
  }
  async function addPos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/fiscal/terminals', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset();
      await onDone();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'POS-i nuk u shtua.');
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Konfiguro biznesin</h2>
        <form className="grid gap-3" onSubmit={save}>
          <Field label="NUI / numri identifikues" hint="E jep ATK. Nuk është i njëjtë automatikisht me numrin në kartelën e kompanisë."><Input name="nui" defaultValue={String(data.nui ?? '')} required pattern="\d{5,18}" /></Field>
          <Field label="Numri i fiskalizimit" hint="Merret nga EDI. Ruhet i fshehur dhe nuk shfaqet përsëri."><Input name="fiscalizationNo" placeholder={data.hasFiscalizationNo ? 'Lëreni bosh për ta mbajtur' : ''} /></Field>
          <Field label="Numri i aplikacionit" hint="E jep ATK pasi të certifikojë programin. Nuk e sajojmë ne."><Input name="applicationId" defaultValue={String(data.applicationId ?? '')} required pattern="[1-9]\d*" /></Field>
          <Field label="Njësia matëse" hint="Faturat nuk e ruajnë njësinë, prandaj vendoset këtu për kuponin."><Input name="defaultUnit" defaultValue={String(data.defaultUnit ?? '')} required /></Field>
          <Field label="Lloji i artikullit" hint="Shembulli publik përdor TT. Vendoseni vetëm nëse ATK e konfirmon për ju."><Input name="itemType" defaultValue={String(data.itemType ?? '')} required /></Field>
          <Field label="Mjedisi">
            <Select name="environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
              <option value="TEST">Test</option>
              <option value="PRODUCTION">Produksion</option>
            </Select>
          </Field>
          {environment === 'PRODUCTION' ? <label className="text-sm"><input type="checkbox" className="mr-2" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />Konfirmoj që produksioni dërgon kuponë të vërtetë te ATK.</label> : null}
          <Button type="submit">Konfiguro biznesin</Button>
        </form>
      </Card>
      <div className="space-y-4">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Dega</h2>
          <form className="grid gap-3" onSubmit={addBranch}>
            <Field label="Numri i degës"><Input name="branchNumber" required pattern="[1-9]\d*" /></Field>
            <Field label="Vendndodhja"><Input name="location" required /></Field>
            <Button type="submit" variant="secondary">Shto degën</Button>
          </form>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">POS-i</h2>
          <form className="grid gap-3" onSubmit={addPos}>
            <Field label="Dega">
              <Select name="branchId" defaultValue="" required>
                <option value="" disabled>Zgjidhni</option>
                {branches.map((branch) => <option key={String(branch.id)} value={String(branch.id)}>Dega {String(branch.branchNumber)}</option>)}
              </Select>
            </Field>
            <Field label="Numri i POS-it"><Input name="posNumber" required pattern="[1-9]\d*" /></Field>
            <Button type="submit" variant="secondary" disabled={branches.length === 0}>Shto POS-in</Button>
          </form>
          <TerminalList branches={branches} onDone={onDone} onMessage={onMessage} />
        </Card>
      </div>
    </div>
  );
}

function TerminalList({ branches, onDone, onMessage }: { branches: Row[]; onDone: () => Promise<unknown>; onMessage: (value: string) => void }) {
  const terminals = branches.flatMap((branch) => ((branch.terminals ?? []) as Row[]).map((terminal) => terminal));
  async function onboard(id: string) {
    try {
      await api(`/api/fiscal/terminals/${id}/onboard`, { method: 'POST', body: '{}' });
      await onDone();
      onMessage('Certifikata u konfigurua në këtë server. Çelësi privat nuk shkarkohet.');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Certifikata nuk u konfigurua.');
    }
  }
  return (
    <div className="mt-4 space-y-2">
      {terminals.map((terminal) => (
        <div key={String(terminal.id)} className="flex items-center justify-between gap-2 text-sm">
          <span>POS {String(terminal.posNumber)} · {terminal.hasCertificate ? 'Certifikata është konfiguruar' : 'Pa certifikatë'}</span>
          <Button type="button" variant="secondary" disabled={terminal.hasCertificate === true} onClick={() => onboard(String(terminal.id))}>Konfiguro certifikatën</Button>
        </div>
      ))}
    </div>
  );
}

function Invoices({ rows, loading, error, terminals, ready, onDone }: { rows: Row[]; loading: boolean; error: unknown; terminals: Row[]; ready: boolean; onDone: (id: string) => Promise<void> }) {
  const [posId, setPosId] = useState('');
  const [paymentKind, setPaymentKind] = useState('CASH');
  if (loading) return <Skeleton className="h-32" />;
  if (error) return <ErrorNote error={error} />;
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={posId} onChange={(event) => setPosId(event.target.value)} aria-label="POS">
          <option value="">Zgjidhni POS-in</option>
          {terminals.map((terminal) => <option key={String(terminal.id)} value={String(terminal.id)}>{String(terminal.label)}</option>)}
        </Select>
        <Select value={paymentKind} onChange={(event) => setPaymentKind(event.target.value)} aria-label="Pagesa">
          {Object.entries(paymentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </Select>
      </div>
      {rows.length === 0 ? <Empty title="Nuk ka fatura" text="Lëshoni një faturë në euro, pastaj kthehuni këtu." /> : rows.map((invoice) => {
        const blockers = (invoice.blockers ?? []) as string[];
        const canSend = ready && blockers.length === 0 && Boolean(posId) && !invoice.receipt;
        return (
          <div key={String(invoice.id)} className="border-t border-line py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{String(invoice.displayNumber ?? 'Pa numër')} · {formatMoney(String(invoice.total ?? '0'))}</p>
                <p className="text-muted">{formatDate(String(invoice.issueDate))} · <Badge value={String(invoice.status)} /></p>
              </div>
              <Button type="button" disabled={!canSend} onClick={async () => {
                const result = await api<Row>(`/api/fiscal/invoices/${invoice.id}/submit`, { method: 'POST', body: JSON.stringify({ posId, paymentKind }) });
                await onDone(String(result.id));
              }}>Dërgo për fiskalizim</Button>
            </div>
            {!canSend ? <p className="mt-1 text-amber-800">{!ready ? 'Konfigurimi nuk është gati.' : !posId ? 'Zgjidhni POS-in.' : blockers[0] ?? 'Kuponi ekziston.'}</p> : null}
          </div>
        );
      })}
    </Card>
  );
}

function History({ rows, query, status, onQuery, onStatus, onOpen }: { rows: Row[]; query: string; status: string; onQuery: (value: string) => void; onStatus: (value: string) => void; onOpen: (id: string) => void }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Numri, kuponi ose transaksioni" aria-label="Kërko" />
        <Select value={status} onChange={(event) => onStatus(event.target.value)} aria-label="Statusi">
          <option value="">Të gjitha</option>
          <option value="FISCALIZED">I fiskalizuar</option>
          <option value="REJECTED">I refuzuar</option>
          <option value="UNKNOWN">Rezultat i panjohur</option>
          <option value="PROCESSING">Duke u dërguar</option>
          <option value="NOT_SENT">Nuk u dërgua</option>
        </Select>
      </div>
      {rows.length === 0 ? <Empty title="Nuk ka kuponë" text="Historiku shfaqet pasi të përgatitet një kupon." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className="py-2">Fatura</th><th>Kuponi</th><th>Data</th><th>Shuma</th><th>POS</th><th>Statusi</th><th>ATK</th><th></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} className="border-t border-line">
                  <td className="py-2">{String(row.invoiceNumber ?? '—')}</td>
                  <td>{String(row.couponId)}</td>
                  <td>{formatDate(String(row.createdAt))}</td>
                  <td>{formatMoney(String(row.total ?? '0'))}</td>
                  <td>{String(row.posNumber ?? '—')}</td>
                  <td><Badge value={String(row.status)} /></td>
                  <td>{String(row.transactionId ?? '—')}</td>
                  <td><Button type="button" variant="secondary" onClick={() => onOpen(String(row.id))}>Shiko detajet</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Detail({ row, error, onDone, onMessage }: { row?: Row; error: unknown; onDone: () => Promise<unknown>; onMessage: (value: string) => void }) {
  const [reason, setReason] = useState('');
  if (error) return <ErrorNote error={error} />;
  if (!row) return <Empty title="Zgjidhni kuponin" text="Hapeni nga historiku ose pas dërgimit." />;
  const unknown = row.status === 'UNKNOWN' || row.status === 'PROCESSING';
  const canMarkUnknown = row.status === 'PROCESSING';
  const canAdjust = row.status === 'FISCALIZED' && row.type === 'SALE';
  return (
    <Card className="p-4 text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{String(row.documentTitle)}</h2>
        <Badge value={String(row.status)} />
      </div>
      <p>Fatura: {String(row.invoiceNumber ?? '—')}</p>
      <p>Kuponi: {String(row.couponId)} · {String(row.type)} · {String(row.environment)}</p>
      <p>Shuma: {formatMoney(String(row.total ?? '0'))}</p>
      <p>Transaksioni ATK: {String(row.transactionId ?? '—')}</p>
      <p>POS: {String(row.posNumber ?? '—')} · Dega: {String(row.branchNumber ?? '—')}</p>
      {row.errorMessage ? <p className="mt-2 text-red-800">{String(row.errorMessage)}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => download(`/api/fiscal/receipts/${row.id}/pdf`, `kupon-${String(row.couponId)}.pdf`)}>Shkarko kuponin</Button>
        <Button type="button" variant="secondary" disabled={!canMarkUnknown} onClick={async () => { await api(`/api/fiscal/receipts/${row.id}/unknown`, { method: 'POST', body: '{}' }); await onDone(); }}>Shëno rezultatin e panjohur</Button>
      </div>
      {unknown ? <p className="mt-2 text-amber-800">Nuk ka “Provo përsëri”. ATK mund ta ketë pranuar kuponin edhe pse përgjigjja nuk mbërriti.</p> : null}
      {canAdjust ? (
        <form className="mt-4 grid max-w-lg gap-2" onSubmit={async (event) => {
          event.preventDefault();
          const kind = String(new FormData(event.currentTarget).get('kind'));
          try {
            await api(`/api/fiscal/receipts/${row.id}/adjust`, { method: 'POST', body: JSON.stringify({ kind, reason }) });
            await onDone();
            onMessage('U dërgua kuponi i anulimit ose i kthimit. Origjinali mbetet në histori.');
          } catch (adjustError) {
            onMessage(adjustError instanceof Error ? adjustError.message : 'Veprimi dështoi.');
          }
        }}>
          <Select name="kind" defaultValue="CANCEL" aria-label="Lloji">
            <option value="CANCEL">Anulim</option>
            <option value="RETURN">Kthim i plotë</option>
          </Select>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Arsyeja" required minLength={3} />
          <Button type="submit" variant="danger">Dërgo anulimin ose kthimin</Button>
        </form>
      ) : null}
      <h3 className="mt-4 font-semibold">Përpjekjet</h3>
      {((row.attempts ?? []) as Row[]).map((attempt) => (
        <p key={String(attempt.id)} className="border-t border-line py-2">{String(attempt.outcome)} · {String(attempt.httpStatus ?? '—')} · {String(attempt.message ?? '')}</p>
      ))}
    </Card>
  );
}

function Check({ ready, note, onDone, onMessage }: { ready: boolean; note: string; onDone: () => Promise<unknown>; onMessage: (value: string) => void }) {
  const mutation = useMutation({
    mutationFn: () => api('/api/fiscal/check', { method: 'POST', body: '{}' }),
    onSuccess: async () => { await onDone(); onMessage('Kontrolli mbaroi. Nuk u krijua kupon fiskal.'); },
    onError: (error) => onMessage(error instanceof Error ? error.message : 'Kontrolli dështoi.'),
  });
  return (
    <Card className="p-4 text-sm">
      <p className="mb-3">Kontrolli hap vetëm faqen e dokumentacionit të mjedisit të zgjedhur. Nuk dërgon kupon dhe nuk është faturë fiskale.</p>
      <p className="mb-3 text-muted">{note || 'Ende pa kontroll.'} Gjendja: {ready ? 'Gati për fiskalizim' : 'Ende jo gati'}.</p>
      <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>Kontrollo konfigurimin</Button>
    </Card>
  );
}
