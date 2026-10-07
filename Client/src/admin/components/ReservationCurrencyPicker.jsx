import api from '../api/axios';

const CURRENCIES = ['EGP', 'USD'];

export default function ReservationCurrencyPicker({ form, setForm, inputClass = 'input', labelClass = 'label' }) {
  const isUsd = form.currency === 'USD';
  const rate = Number(form.exchange_rate);

  async function choose(code) {
    if (code === form.currency || (code === 'EGP' && !form.currency)) return;
    setForm((cur) => ({ ...cur, currency: code }));
    if (code === 'USD' && !(Number(form.exchange_rate) > 0)) {
      try {
        const { data } = await api.get('/reservations/usd-rate');
        if (data?.rate > 0) {
          setForm((cur) => (Number(cur.exchange_rate) > 0 ? cur : { ...cur, exchange_rate: String(data.rate) }));
        }
      } catch {
        // Rate stays empty; the user types it in.
      }
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <p className={labelClass}>Currency</p>
        <div className="grid grid-cols-2 gap-2">
          {CURRENCIES.map((code) => {
            const active = (form.currency || 'EGP') === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => choose(code)}
                className={`rounded-[10px] border px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                    : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-[#f6f8fb]'
                }`}
              >
                {code}
              </button>
            );
          })}
        </div>
      </div>
      {isUsd && (
        <div>
          <p className={labelClass}>Exchange rate (EGP per 1 USD) *</p>
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
              ? `Saved in EGP for reports and finance (1 USD = EGP ${rate.toLocaleString('en-US', { maximumFractionDigits: 4 })}).`
              : 'Used to convert the amounts to EGP for reports and finance.'}
          </p>
        </div>
      )}
    </div>
  );
}
