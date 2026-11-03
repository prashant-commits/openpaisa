import type { Paise } from './types.js';

/** Parse an Indian-formatted amount string ("1,23,456.78", "₹ 499.00", "1,000.00 Dr") into paise. */
export function toPaise(input: string): Paise {
  const cleaned = input.replace(/[₹,\s]|INR|Rs\.?|Dr|Cr/gi, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error(`Not an amount: ${input}`);
  const [whole, frac = ''] = cleaned.replace('-', '').split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return cleaned.startsWith('-') ? -paise : paise;
}

/** Format paise as Indian rupees: 12345678 -> "₹1,23,456.78"; whole rupees drop decimals. */
export function formatINR(paise: Paise, opts: { decimals?: boolean } = {}): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const frac = abs % 100;
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  const dec = opts.decimals ?? frac !== 0;
  return `${neg ? '-' : ''}₹${grouped}${dec ? '.' + String(frac).padStart(2, '0') : ''}`;
}
