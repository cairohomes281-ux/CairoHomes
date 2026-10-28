import { useState } from 'react';
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
  const [loading, setLoading] = useState(false);
  const [liveNote, setLiveNote] = useState('');

  async function choose(next) {
    if (next === form.currency) return;
    if (!requireChoice && next === 'EGP' && !form.currency) return;
    if (next === 'EGP') {
      setLiveNote('');
      setForm((cur) => ({ ...cur, currency: 'EGP', exchange_rate: '' }));
      return;
    }
    setLoading(true);
    setLiveNote('');
    setForm((cur) => ({ ...cur, currency: next }));
    try {
      const { data } = await api.get(`/fx/egp/${next}`);
      const live = Number(data?.egp_per_unit);
      if (live > 0) {
        setForm((cur) => ({ ...cur, currency: next, exchange_rate: String(live) }));
        setLiveNote('Live rate');
      }
    } catch {
      setLiveNote('Live rate unavailable');
    } finally {
      setLoading(false);
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
          <p className={labelClass}>Exchange rate (EGP per 1 {code})</p>
          <input
            type="text"
            readOnly
            className={`${inputClass} bg-[#f6f8fb]`}
            value={loading ? 'Loading live rate…' : form.exchange_rate ?? ''}
          />
          <p className="mt-1 text-[11px] text-[#5b6b80]">
            {loading
              ? 'Fetching the live rate.'
              : rate > 0
                ? `${liveNote || 'Live rate'} · 1 ${code} = EGP ${rate.toLocaleString('en-US', { maximumFractionDigits: 4 })}. Amounts are still saved in EGP.`
                : liveNote || 'The live rate fills in when you choose a currency.'}
          </p>
        </div>
      )}
    </div>
  );
}
