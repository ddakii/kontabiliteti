import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell';
import { useSession } from './lib/session';
import {
  ForgotPage,
  HomePage,
  InvitePage,
  LoginPage,
  RegisterPage,
  ResetPage,
  VerifyPage,
} from './pages/public';
import {
  AgingPage,
  AuditPage,
  BanksPage,
  CalendarPage,
  CompanyWorkspacePage,
  DashboardPage,
  DirectoryPage,
  InboxPage,
  MonthPage,
} from './pages/operate';
import {
  AccountingPage,
  InvoiceDetailPage,
  InvoicesPage,
  EmployeesPage,
  PaymentsPage,
  PlatformPage,
  PortalPage,
  PrintInvoicePage,
  PrintPurchasePage,
  PurchaseDetailPage,
  PurchasesPage,
  ReportsPage,
  SearchPage,
  SubscriptionPage,
  TasksPage,
  TaxPage,
  TeamPage,
} from './pages/work';
import { FiscalPage } from './pages/fiscal';

function Guard({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useSession();
  if (loading) return <p className="p-8 text-sm text-muted">Po ngarkohet…</p>;
  if (!profile) return <Navigate to="/hyrje" replace />;
  return children;
}

function Workspace() {
  const { profile } = useSession();
  if (profile && profile.firms.length === 0 && profile.clientCompanies.length > 0) return <Navigate to="/portali" replace />;
  if (profile && profile.firms.length === 0 && profile.user.isPlatformAdmin) return <Navigate to="/platforma" replace />;
  return <AppShell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Guard><Workspace /></Guard>}>
        <Route index element={<DashboardPage />} />
        <Route path="klientet" element={<DirectoryPage />} />
        <Route path="klientet/:id" element={<CompanyWorkspacePage />} />
        <Route path="faturat" element={<InvoicesPage />} />
        <Route path="faturat/:id" element={<InvoiceDetailPage />} />
        <Route path="blerjet" element={<PurchasesPage />} />
        <Route path="blerjet/:id" element={<PurchaseDetailPage />} />
        <Route path="puntoret" element={<EmployeesPage />} />
        <Route path="pagesat" element={<PaymentsPage />} />
        <Route path="bankat" element={<BanksPage />} />
        <Route path="muaji" element={<MonthPage />} />
        <Route path="kontabiliteti" element={<AccountingPage />} />
        <Route path="tvsh" element={<TaxPage />} />
        <Route path="fiskalizimi" element={<FiscalPage />} />
        <Route path="raportet" element={<ReportsPage />} />
        <Route path="vjetersimi" element={<AgingPage />} />
        <Route path="detyrat" element={<TasksPage />} />
        <Route path="kalendari" element={<CalendarPage />} />
        <Route path="dokumentet" element={<InboxPage />} />
        <Route path="ekipi" element={<TeamPage />} />
        <Route path="abonimi" element={<SubscriptionPage />} />
        <Route path="auditimi" element={<AuditPage />} />
        <Route path="kerko" element={<SearchPage />} />
        <Route path="platforma" element={<PlatformPage />} />
      </Route>
      <Route path="/print/fatura/:id" element={<Guard><PrintInvoicePage /></Guard>} />
      <Route path="/print/blerje/:id" element={<Guard><PrintPurchasePage /></Guard>} />
      <Route path="/portali" element={<Guard><PortalPage /></Guard>} />
      <Route path="/fillimi" element={<HomePage />} />
      <Route path="/hyrje" element={<LoginPage />} />
      <Route path="/regjistrohu" element={<RegisterPage />} />
      <Route path="/verifiko-emailin" element={<VerifyPage />} />
      <Route path="/fjalekalimi" element={<ForgotPage />} />
      <Route path="/rivendos-fjalekalimin" element={<ResetPage />} />
      <Route path="/ftesa" element={<InvitePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
