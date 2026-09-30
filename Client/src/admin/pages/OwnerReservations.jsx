import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency, formatDate, unitDisplay } from '../utils/formatters';
import Badge from '../components/ui/Badge';

export default function OwnerReservations() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['owner-reservations'],
    queryFn: () => api.get('/owner/reservations').then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
        <p className="text-sm text-gray-500">
          Nights amount only (no utilities, housekeeping, or service fees). Guest identity is never
          shown.
        </p>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {!data.length ? (
          <p className="p-8 text-center text-gray-400 text-sm">No reservations yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Unit</th>
                  <th className="px-4 py-3 text-left">Dates</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Commission</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((r) => {
                  const showMoney = r.show_money !== false && r.status !== 'rejected';
                  const pct = r.commission_pct != null ? Number(r.commission_pct) : 20;
                  return (
                    <tr key={r.id || r.booking_ref}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {unitDisplay(r)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatDate(r.check_in)} → {formatDate(r.check_out)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {showMoney ? currency(r.gross) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {showMoney ? (
                          <span>
                            {currency(r.commission)}
                            <span className="ml-1 text-xs text-gray-400">({pct}%)</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {showMoney ? currency(r.net) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge status={r.status} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge status={r.payment_status || 'pending'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
