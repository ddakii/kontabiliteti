import type { AccountType, NormalBalance } from '@prisma/client';

export type AccountTemplate = {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  description: string;
};

/**
 * Plan kontabël fillestar i konfigurueshëm.
 * Nuk është plani zyrtar i detyrueshëm i Kosovës dhe duhet përshtatur nga zyra.
 */
export const DEFAULT_ACCOUNTS: AccountTemplate[] = [
  { code: '1000', name: 'Arka', type: 'ASSET', normalBalance: 'DEBIT', description: 'Paraja e gatshme.' },
  { code: '1020', name: 'Llogaritë bankare', type: 'ASSET', normalBalance: 'DEBIT', description: 'Llogaritë rrjedhëse.' },
  { code: '1100', name: 'Llogaritë e arkëtueshme', type: 'ASSET', normalBalance: 'DEBIT', description: 'Kërkesat ndaj blerësve.' },
  { code: '1200', name: 'TVSH e zbritshme', type: 'ASSET', normalBalance: 'DEBIT', description: 'TVSH-ja në blerje, kur lejohet zbritja.' },
  { code: '1500', name: 'Inventari', type: 'ASSET', normalBalance: 'DEBIT', description: 'Mallrat dhe materialet.' },
  { code: '1600', name: 'Mjetet themelore', type: 'ASSET', normalBalance: 'DEBIT', description: 'Asetet afatgjata.' },
  { code: '1690', name: 'Amortizimi i akumuluar', type: 'ASSET', normalBalance: 'CREDIT', description: 'Llogari kundëraktive e mjeteve.' },
  { code: '2000', name: 'Llogaritë e pagueshme', type: 'LIABILITY', normalBalance: 'CREDIT', description: 'Detyrimet ndaj furnitorëve.' },
  { code: '2100', name: 'TVSH e llogaritur', type: 'LIABILITY', normalBalance: 'CREDIT', description: 'TVSH-ja në shitje.' },
  { code: '2200', name: 'TVSH për t\'u paguar', type: 'LIABILITY', normalBalance: 'CREDIT', description: 'Pozicioni i TVSH-së.' },
  { code: '2300', name: 'Detyrime për paga', type: 'LIABILITY', normalBalance: 'CREDIT', description: 'Pagat e palikuiduara.' },
  { code: '2310', name: 'Detyrime për tatimin në paga', type: 'LIABILITY', normalBalance: 'CREDIT', description: 'Tatimi i mbajtur në burim.' },
  { code: '2320', name: 'Detyrime pensionale', type: 'LIABILITY', normalBalance: 'CREDIT', description: 'Kontributet pensionale.' },
  { code: '3000', name: 'Kapitali', type: 'EQUITY', normalBalance: 'CREDIT', description: 'Kapitali i pronarëve.' },
  { code: '3100', name: 'Fitimet e pashpërndara', type: 'EQUITY', normalBalance: 'CREDIT', description: 'Rezultatet e bartura.' },
  { code: '4000', name: 'Të hyrat nga shitja', type: 'REVENUE', normalBalance: 'CREDIT', description: 'Të hyrat operative.' },
  { code: '5000', name: 'Kosto e shitjes', type: 'EXPENSE', normalBalance: 'DEBIT', description: 'Kostoja e mallrave ose shërbimeve.' },
  { code: '6000', name: 'Shpenzime operative', type: 'EXPENSE', normalBalance: 'DEBIT', description: 'Shpenzimet e përgjithshme.' },
  { code: '6100', name: 'Shpenzime të pagave', type: 'EXPENSE', normalBalance: 'DEBIT', description: 'Kostoja e pagave.' },
  { code: '6200', name: 'Shpenzime të qirasë', type: 'EXPENSE', normalBalance: 'DEBIT', description: 'Qiraja.' },
  { code: '6800', name: 'Shpenzime të amortizimit', type: 'EXPENSE', normalBalance: 'DEBIT', description: 'Amortizimi i politikës kontabël.' },
];

export const DEFAULT_MAPPINGS = {
  accountsReceivable: '1100',
  accountsPayable: '2000',
  salesRevenue: '4000',
  outputVat: '2100',
  inputVat: '1200',
  cash: '1000',
  bank: '1020',
  expenseDefault: '6000',
  salaryExpense: '6100',
  salaryPayable: '2300',
  payrollTaxPayable: '2310',
  pensionPayable: '2320',
  retainedEarnings: '3100',
  fixedAssets: '1600',
  accumulatedDepreciation: '1690',
  depreciationExpense: '6800',
  inventory: '1500',
  cogs: '5000',
};

export const DEFAULT_EXPENSE_CATEGORIES = ['Shërbime', 'Qira', 'Materiale', 'Komunali', 'Të tjera'];

export const KOSOVO_MUNICIPALITIES = [
  'Deçan',
  'Dragash',
  'Ferizaj',
  'Fushë Kosovë',
  'Gjakovë',
  'Gjilan',
  'Gllogoc',
  'Graçanicë',
  'Hani i Elezit',
  'Istog',
  'Junik',
  'Kaçanik',
  'Kamenicë',
  'Klinë',
  'Kllokot',
  'Leposaviq',
  'Lipjan',
  'Malishevë',
  'Mamushë',
  'Mitrovicë e Jugut',
  'Mitrovicë e Veriut',
  'Novobërdë',
  'Obiliq',
  'Partesh',
  'Pejë',
  'Podujevë',
  'Prishtinë',
  'Prizren',
  'Rahovec',
  'Ranillug',
  'Skenderaj',
  'Shtime',
  'Shtërpcë',
  'Suharekë',
  'Viti',
  'Vushtrri',
  'Zubin Potok',
  'Zveçan',
];

export const TAX_DISCLAIMER =
  'Përmbledhje e brendshme e përgatitur nga regjistrimet e programit. Nuk është deklaratë e dorëzuar te Administrata Tatimore e Kosovës dhe nuk vërteton trajtimin ligjor.';

export const TAX_TEMPLATES = [
  {
    code: 'TVSH18',
    name: 'Norma standarde e TVSH-së',
    ratePercent: '18.0000',
    treatment: 'STANDARD' as const,
    effectiveFrom: '2015-09-01',
    sourceNote:
      'Shabllon referues për Ligjin Nr. 05/L-037 për Tatimin mbi Vlerën e Shtuar dhe ndryshimet e tij. Programi nuk e verifikon automatikisht tekstin aktual të Gazetës Zyrtare ose udhëzimet e ATK-së. Kontabilisti duhet ta konfirmojë para përdorimit.',
  },
  {
    code: 'TVSH8',
    name: 'Norma e reduktuar e TVSH-së',
    ratePercent: '8.0000',
    treatment: 'REDUCED' as const,
    effectiveFrom: '2015-09-01',
    sourceNote:
      'Shabllon referues për normën e reduktuar të Ligjit Nr. 05/L-037. Lista e furnizimeve që i nënshtrohen kësaj norme duhet verifikuar me legjislacionin aktual. Nuk është e konfirmuar nga programi.',
  },
  {
    code: 'TVSH0',
    name: 'Norma zero',
    ratePercent: '0.0000',
    treatment: 'ZERO' as const,
    effectiveFrom: '2015-09-01',
    sourceNote: 'Shabllon për furnizime me normë zero. Zbatimi varet nga rregullat aktuale dhe duhet konfirmuar nga kontabilisti.',
  },
  {
    code: 'TVSH-LIR',
    name: 'E liruar nga TVSH',
    ratePercent: '0.0000',
    treatment: 'EXEMPT' as const,
    effectiveFrom: '2015-09-01',
    sourceNote: 'Shabllon për furnizime të liruara. Përjashtimet nuk duhen supozuar pa bazë ligjore të verifikuar.',
  },
];
