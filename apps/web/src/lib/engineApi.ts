import * as engine from '@openpaisa/engine';
import type { AmortisationRow, IsoDate, Loan, Paise, PrepaymentResult } from '@openpaisa/engine';

/*
 * amortise and prepay are being added to the engine by another lane. Reaching them
 * through the namespace object keeps this file compiling before and after they land.
 */
type Amortise = (loan: Loan, asOf: IsoDate) => AmortisationRow[];
type Prepay = (loan: Loan, amount: Paise, mode: PrepaymentResult['mode'], asOf: IsoDate) => PrepaymentResult;
const optional = engine as unknown as { amortise?: Amortise; prepay?: Prepay };

export const amortiseFn: Amortise | undefined = typeof optional.amortise === 'function' ? optional.amortise : undefined;
export const prepayFn: Prepay | undefined = typeof optional.prepay === 'function' ? optional.prepay : undefined;
