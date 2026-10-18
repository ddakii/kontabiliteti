export type SetupStep = { code: string; label: string; done: boolean };

export function fiscalReadiness(input: {
  dataComplete: boolean;
  certificateConfigured: boolean;
  connectionChecked: boolean;
}): { label: string; ready: boolean; steps: SetupStep[] } {
  const ready = input.dataComplete && input.certificateConfigured && input.connectionChecked;
  const steps: SetupStep[] = [
    { code: 'DATA', label: 'Të dhënat janë plotësuar', done: input.dataComplete },
    { code: 'CERTIFICATE', label: 'Certifikata është konfiguruar', done: input.certificateConfigured },
    { code: 'CONNECTION', label: 'Testi i lidhjes ka përfunduar', done: input.connectionChecked },
    { code: 'READY', label: 'Gati për fiskalizim', done: ready },
  ];
  let label = 'Konfigurimi nuk ka përfunduar';
  if (ready) label = 'Gati për fiskalizim';
  else if (input.certificateConfigured) label = 'Certifikata është konfiguruar';
  else if (input.dataComplete) label = 'Të dhënat janë plotësuar';
  return { label, ready, steps };
}

/** Titulli i dokumentit. "Faturë e fiskalizuar" vetëm pas përgjigjes së suksesshme me numër transaksioni. */
export function fiscalDocumentTitle(status: string, transactionId: string | null | undefined): string {
  if (status === 'FISCALIZED' && transactionId) return 'Faturë e fiskalizuar';
  if (status === 'REJECTED') return 'Kupon i refuzuar nga ATK';
  if (status === 'UNKNOWN' || status === 'PROCESSING') return 'Rezultati i fiskalizimit nuk është konfirmuar';
  if (status === 'NOT_SENT') return 'Kuponi nuk u dërgua te ATK';
  return 'Parapamje e kuponit — nuk është dërguar te ATK';
}
