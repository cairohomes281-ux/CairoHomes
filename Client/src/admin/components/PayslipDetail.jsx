import { Receipt } from 'lucide-react';
import { ROLE_LABELS } from '../utils/permissions';
import { currency, formatDate } from '../utils/formatters';
import { DEDUCTION_TYPE_LABELS } from '../utils/hrPolicy';

export const PAYSLIP_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function LineSection({ title, items, dateKey, empty, negative }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-ch-muted mb-2">{title}</h3>
      {!items.length ? (
        <p className="text-sm text-ch-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-ch-line">
          {items.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div>
                <div className="text-ch-pine">
                  {DEDUCTION_TYPE_LABELS[row.category] || row.reason}
                </div>
                <div className="text-[11px] text-ch-muted">
                  {formatDate(row[dateKey])}
                  {row.reason && DEDUCTION_TYPE_LABELS[row.category] ? ` · ${row.reason}` : ''}
                  {row.arrival_time ? ` · arrived ${String(row.arrival_time).slice(0, 5)}` : ''}
                </div>
              </div>
              <span className={`tabular-nums whitespace-nowrap font-semibold ${negative ? 'text-rose-700' : 'text-emerald-700'}`}>
                {negative ? '−' : '+'}
                {currency(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PayslipDetail({ data, year, month, fallbackName }) {
  if (!data) return null;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-ch-pine" />
          </div>
          <div>
            <div className="font-semibold text-ch-pine">{data.full_name || fallbackName}</div>
            <div className="text-[11px] text-ch-muted">
              {data.staff_code ? `${data.staff_code} · ` : ''}
              {ROLE_LABELS[data.role] || data.role}
              {' · '}
              {PAYSLIP_MONTHS[month - 1]} {year}
            </div>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            data.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
          }`}
        >
          {data.status === 'paid' ? 'Paid' : 'Unpaid'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Base', value: data.base_salary, className: 'text-ch-pine' },
          { label: 'Bonuses', value: data.bonuses, className: 'text-emerald-700' },
          { label: 'Penalties', value: data.penalties, className: 'text-rose-700' },
          { label: 'Deductions', value: data.deductions, className: 'text-rose-700' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-ch-line px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-ch-muted">{card.label}</p>
            <p className={`font-num font-semibold ${card.className}`}>{currency(card.value)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-slate-50 border border-ch-line px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-ch-pine">Net pay</span>
        <span className="font-num text-xl font-bold text-ch-pine">{currency(data.net_pay)}</span>
      </div>

      <LineSection
        title="Bonuses"
        items={data.bonus_items || []}
        dateKey="bonus_date"
        empty="No bonuses this month"
      />
      <LineSection
        title="Penalties"
        items={data.penalty_items || []}
        dateKey="deduction_date"
        empty="No penalties this month"
        negative
      />
      <LineSection
        title="Deductions"
        items={data.deduction_items || []}
        dateKey="deduction_date"
        empty="No deductions this month"
        negative
      />

      {data.paid_at ? (
        <p className="text-[11px] text-ch-muted">Recorded as paid on {formatDate(data.paid_at)}</p>
      ) : null}
    </div>
  );
}
