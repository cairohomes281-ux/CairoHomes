import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, DollarSign, Wallet, Receipt } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency, formatDate, unitDisplay } from '../utils/formatters';

function Card({ icon: Icon, title, value, sub, tone }) {
  const valueCls =
    tone === 'rose' ? 'text-rose-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex gap-4 items-center shadow-sm">
      <div className="w-11 h-11 rounded-xl bg-teal-50 flex items-center justify-center">
        <Icon className="w-5 h-5 text-teal-700" />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
        <p className={`text-xl font-semibold ${valueCls}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function OwnerDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: () => api.get('/owner/dashboard').then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) {
    return <p className="text-red-600 text-sm">Failed to load owner dashboard</p>;
  }

  const expenses = data?.expenses || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Owner Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Your units, earnings, expenses, and payouts — no guest details shown
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card icon={Building2} title="Units" value={data?.units?.length ?? 0} />
        <Card
          icon={CalendarDays}
          title="Occupancy"
          value={`${data?.occupancy_pct ?? 0}%`}
          sub={`ADR ${currency(data?.adr)}`}
        />
        <Card
          icon={DollarSign}
          title="Owner net (stays)"
          value={currency(data?.owner_net)}
          sub={`GBV ${currency(data?.gbv)}`}
        />
        <Card
          icon={Receipt}
          title="Owner expenses"
          value={currency(data?.owner_expenses)}
          tone="rose"
          sub="Deducted from your statement"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          icon={Wallet}
          title="Net after expenses"
          value={currency(data?.net_after_expenses ?? data?.owner_net)}
          tone="emerald"
          sub={
            data?.next_payout_date
              ? `Next cycle ${String(data.next_payout_date).slice(0, 10)}`
              : 'Available for payout request'
          }
        />
        <Card
          icon={Wallet}
          title="Pending / available"
          value={currency(data?.pending)}
          sub={`Paid to date ${currency(data?.paid)}`}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/admin/owner/blocks" className="btn-secondary text-sm">
          Block dates
        </Link>
        <Link to="/admin/owner/reservations" className="btn-secondary text-sm">
          View reservations
        </Link>
        <Link to="/admin/owner/statement" className="btn-secondary text-sm">
          Statement
        </Link>
        <Link to="/admin/owner/payouts" className="btn-primary text-sm">
          Request payout
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-900 flex items-center justify-between">
          <span>Recent expenses charged to you</span>
          <Link to="/admin/owner/statement" className="text-xs font-medium text-primary-700 hover:underline">
            Full statement
          </Link>
        </div>
        {expenses.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No owner-paid expenses in the books period yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-5 py-3 text-left">Date</th>
                  <th className="px-5 py-3 text-left">Unit</th>
                  <th className="px-5 py-3 text-left">Description</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-3 whitespace-nowrap">{formatDate(e.expense_date)}</td>
                    <td className="px-5 py-3">{unitDisplay(e)}</td>
                    <td className="px-5 py-3">{e.description}</td>
                    <td className="px-5 py-3 text-right font-semibold text-rose-700 tabular-nums">
                      − {currency(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-900">Your units</div>
        {(data?.units || []).length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No units linked yet. Ask admin to map owner_units.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.units.map((u) => (
              <li key={u.id} className="px-5 py-3 flex justify-between text-sm">
                <span className="font-medium text-gray-800">{unitDisplay(u)}</span>
                <span className="text-gray-500">
                  {u.project || u.compound || '—'} · {u.ops_status || u.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
