import api from '../api/axios';
import { MONEY_CURRENCIES } from '../utils/reservationCurrency';

export default function ReservationCurrencyPicker({
  form,
  setForm,
  inputClass = 'input',
  labelClass = 'label',
  requireChoice = false,
  currencies = MONEY_CURRENCIES,
}) {
  const code = String(form.currency || (requireChoice ? '' : 'EGP')).toUpperCase();
  const isForeign = code && code !== 'EGP';
  const rate = Number(form.exchange_rate);

  async function choose(next) {
    if (next === form.currency) return;
    if (!requireChoice && next === 'EGP' && !form.currency) return;
    setForm((cur) => ({ ...cur, currency: next }));
    if (next !== 'EGP' && !(Number(form.exchange_rate) > 0) && next === 'USD') {
      try {
        const { data } = await api.get('/reservations/usd-rate');
        if (data?.rate > 0) {
          setForm((cur) =>
            Number(cur.exchange_rate) > 0 ? cur : { ...cur, exchange_rate: String(data.rate) }
          );
        }
      } catch {
        // Rate stays empty; the user types it in.
      }
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <p className={labelClass}>Currency</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-4">
          {currencies.map((c) => {
            const active = requireChoice ? form.currency === c : (form.currency || 'EGP') === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => choose(c)}
                className={`rounded-[10px] border px-2 py-2 text-sm font-semibold transition ${
                  active
                    ? 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                    : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-[#f6f8fb]'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>
      {isForeign && (
        <div className="sm:col-span-2">
          <p className={labelClass}>Exchange rate (EGP per 1 {code}) *</p>
          <input
            type="number"
            min="0"
            step="0.0001"
            className={inputClass}
            value={form.exchange_rate ?? ''}
            onChange={(e) => setForm((cur) => ({ ...cur, exchange_rate: e.target.value }))}
            placeholder="e.g. 52.43"
          />
          <p className="mt-1 text-[11px] text-[#5b6b80]">
            {rate > 0
              ? `Saved in EGP for reports and finance (1 ${code} = EGP ${rate.toLocaleString('en-US', { maximumFractionDigits: 4 })}).`
              : `Used to convert the amounts to EGP for reports and finance.`}
          </p>
        </div>
      )}
    </div>
  );
}
