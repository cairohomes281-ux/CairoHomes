function defaultRange() {
  const to = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const fromDt = new Date(`${to}T12:00:00Z`);
  fromDt.setUTCDate(fromDt.getUTCDate() - 6);
  return { from: fromDt.toISOString().slice(0, 10), to };
}

export function useSiteHealthRange() {
  const initial = defaultRange();
  return initial;
}

export function DateRangePicker({ fromDate, toDate, setFromDate, setToDate }) {
  return (
    <div className="card p-3 flex flex-wrap items-end gap-3">
      <div>
        <label className="label text-xs">From</label>
        <input
          type="date"
          className="input w-40"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
      </div>
      <div>
        <label className="label text-xs">To</label>
        <input
          type="date"
          className="input w-40"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
      </div>
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 text-ch-muted text-xs font-semibold uppercase tracking-wide">
        <Icon className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
        {label}
      </div>
      <p className="mt-2 font-display text-3xl text-ch-pine">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ch-muted">{hint}</p> : null}
    </div>
  );
}

export function formatDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatWhen(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}
