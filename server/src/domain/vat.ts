import Decimal from 'decimal.js';
import { money } from './money';

export type VatRow = {
  treatment: 'STANDARD' | 'REDUCED' | 'ZERO' | 'EXEMPT' | 'OUT_OF_SCOPE';
  net: string;
  vat: string;
  deductible?: boolean;
};

export function summarizeVat(sales: VatRow[], purchases: VatRow[]) {
  const salesNet = money(sales.reduce((sum, row) => sum.plus(row.net), new Decimal(0)));
  const salesVat = money(sales.reduce((sum, row) => sum.plus(row.vat), new Decimal(0)));
  const purchaseNet = money(purchases.reduce((sum, row) => sum.plus(row.net), new Decimal(0)));
  const purchaseVat = money(purchases.reduce((sum, row) => sum.plus(row.vat), new Decimal(0)));
  const deductibleVat = money(
    purchases.filter((row) => row.deductible !== false).reduce((sum, row) => sum.plus(row.vat), new Decimal(0)),
  );
  const nonDeductibleVat = money(purchaseVat.minus(deductibleVat));
  const exemptSales = money(
    sales
      .filter((row) => row.treatment === 'EXEMPT' || row.treatment === 'OUT_OF_SCOPE')
      .reduce((sum, row) => sum.plus(row.net), new Decimal(0)),
  );
  const vatPosition = money(salesVat.minus(deductibleVat));
  return {
    salesNet: salesNet.toFixed(2),
    salesVat: salesVat.toFixed(2),
    purchaseNet: purchaseNet.toFixed(2),
    purchaseVat: purchaseVat.toFixed(2),
    deductibleVat: deductibleVat.toFixed(2),
    nonDeductibleVat: nonDeductibleVat.toFixed(2),
    exemptSales: exemptSales.toFixed(2),
    vatPosition: vatPosition.toFixed(2),
    positionLabel: vatPosition.gte(0) ? 'TVSH për t\'u paguar' : 'TVSH për t\'u kthyer ose kreditur',
    disclaimer:
      'Përmbledhje e brendshme e përgatitur nga regjistrimet e programit. Nuk është deklaratë e dorëzuar te Administrata Tatimore e Kosovës dhe nuk vërteton trajtimin ligjor të TVSH-së.',
  };
}
