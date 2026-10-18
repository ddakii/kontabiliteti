import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, getCompanyId, getFirmId, setCompanyId, setFirmId } from './api';

export type Profile = {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    isPlatformAdmin: boolean;
  };
  firms: { id: string; legalName: string; role: string; roleName: string; status: string; permissions?: string[] }[];
  clientCompanies: { id: string; legalName: string; firmId: string; canUpload: boolean }[];
};

type SessionValue = {
  profile?: Profile;
  loading: boolean;
  firmId: string;
  companyId: string;
  refresh: () => Promise<void>;
  chooseFirm: (id: string) => void;
  chooseCompany: (id: string) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<Profile>();
  const [loading, setLoading] = useState(true);
  const [firmId, setFirm] = useState(getFirmId());
  const [companyId, setCompany] = useState(getCompanyId());

  async function refresh() {
    try {
      const next = await api<Profile>('/api/auth/me');
      setProfile(next);
      const firm = next.firms.find((item) => item.id === getFirmId()) ?? next.firms[0];
      if (firm && firm.id !== getFirmId()) {
        setFirmId(firm.id);
        setFirm(firm.id);
      }
    } catch {
      setProfile(undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      profile,
      loading,
      firmId,
      companyId,
      refresh,
      chooseFirm: (id: string) => {
        setFirmId(id);
        setFirm(id);
        setCompanyId('');
        setCompany('');
        queryClient.clear();
      },
      chooseCompany: (id: string) => {
        setCompanyId(id);
        setCompany(id);
        const recent = JSON.parse(localStorage.getItem('kontabiliteti.recent') ?? '[]') as string[];
        localStorage.setItem('kontabiliteti.recent', JSON.stringify([id, ...recent.filter((item) => item !== id)].slice(0, 6)));
        queryClient.removeQueries({
          predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'company',
        });
      },
    }),
    [profile, loading, firmId, companyId, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Sesioni mungon.');
  return value;
}
