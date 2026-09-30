import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency, formatDate, unitDisplay } from '../utils/formatters';

export default function OwnerStatementPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = {};
  if (from) params.from_date = from;
  if (to) params.to_date = to;

  const { data, isLoading } = useQuery({
    queryKey: ['owner-statement', from, to],
    queryFn: async () => {
      const units = await api.get('/owner/units').then((r) => r.data);
      const unit_id = units[0]?.id;
      if (!unit_id) return { lines: [], totals: {} };
      return api
        .get('/reports/owner-statement', { params: { ...params, unit_id } })
        .then((r) => r.data);
    },
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Statement</h1>
        <p className="text-sm text-gray-500">Period totals for your units</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4">
          <p className="text-xs text-gray-500">Gross</p>
          <p className="text-lg font-semibold">{currency(data?.totals?.gross)}</p>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <p className="text-xs text-gray-500">Commission</p>
          <p className="text-lg font-semibold">{currency(data?.totals?.commission)}</p>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <p className="text-xs text-gray-500">Net</p>
          <p className="text-lg font-semibold text-emerald-700">{currency(data?.totals?.net)}</p>
        </div>
      </div>
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Ref</th>
              <th className="px-4 py-3 text-left">Unit</th>
              <th className="px-4 py-3 text-left">Check-in</th>
              <th className="px-4 py-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(data?.lines || []).map((l) => (
              <tr key={l.reservation_id}>
                <td className="px-4 py-3 font-mono text-xs">{l.booking_ref}</td>
                <td className="px-4 py-3">{unitDisplay(l)}</td>
                <td className="px-4 py-3">{formatDate(l.check_in)}</td>
                <td className="px-4 py-3 text-right">{currency(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OwnerPayoutsPage() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [settlementId, setSettlementId] = useState('');
  const [confirm2fa, setConfirm2fa] = useState(false);

  const { data: dash } = useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: () => api.get('/owner/dashboard').then((r) => r.data),
  });
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['owner-payouts'],
    queryFn: () => api.get('/owner/payout-requests').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/owner/payout-requests', {
        amount: Number(amount),
        settlement_id: settlementId || undefined,
        two_fa_verified: confirm2fa ? 1 : 0,
      }),
    onSuccess: () => {
      toast.success('Payout requested');
      setAmount('');
      setConfirm2fa(false);
      qc.invalidateQueries({ queryKey: ['owner-payouts'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Request blocked'),
  });

  if (isLoading) return <LoadingSpinner />;

  const readySettlements = (dash?.settlements || []).filter((s) => s.status === 'ready');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payout requests</h1>
        <p className="text-sm text-gray-500">
          Payouts only allowed against ready settlements (unsettled/disputed funds are blocked)
        </p>
      </div>

      <div className="bg-white border rounded-xl p-5 space-y-3 max-w-lg">
        <label className="block text-xs font-medium text-gray-500">Ready settlement</label>
        <select
          value={settlementId}
          onChange={(e) => setSettlementId(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Select…</option>
          {readySettlements.map((s) => (
            <option key={s.id} value={s.id}>
              #{s.id} · {String(s.period_start).slice(0, 10)}–{String(s.period_end).slice(0, 10)} ·{' '}
              {currency(s.net_amount)}
            </option>
          ))}
        </select>
        <label className="block text-xs font-medium text-gray-500">Amount (EGP)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={confirm2fa} onChange={(e) => setConfirm2fa(e.target.checked)} />
          I confirm this payout request (2FA placeholder)
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={!amount || !confirm2fa || create.isPending}
          onClick={() => create.mutate()}
        >
          Request payout
        </button>
        {!readySettlements.length && (
          <p className="text-xs text-amber-600">No ready settlements — Finance must mark a period ready first.</p>
        )}
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">#{r.id}</td>
                <td className="px-4 py-3 text-right">{currency(r.amount)}</td>
                <td className="px-4 py-3">{r.status}</td>
                <td className="px-4 py-3">{formatDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
