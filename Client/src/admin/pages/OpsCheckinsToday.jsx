import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import { currency } from '../utils/formatters';
import { OpsDateRangeFilter, formatOpsDay } from '../components/OpsDateRangeFilter';
import ReservationCurrencyPicker from '../components/ReservationCurrencyPicker';
import {
  foreignFromEgp,
  MONEY_CURRENCIES,
  reservationCurrencyCode,
  reservationMoney,
  reservationRate,
} from '../utils/reservationCurrency';

function MoneyLine({ label, value, emphasize = false, showZero = false }) {
  if (value == null || (!showZero && Number(value) === 0)) return null;
  return (
    <div className={`flex justify-between gap-3 ${emphasize ? 'border-t pt-1 font-semibold' : ''}`}>
      <span className={emphasize ? 'text-amber-800' : 'text-gray-500'}>{label}</span>
      <span className={`tabular-nums ${emphasize ? 'text-amber-900 font-bold' : 'font-medium'}`}>
        {currency(value)}
      </span>
    </div>
  );
}

function PaymentDetails({ row }) {
  const b = row.payment_breakdown || {};
  const remaining = Number(row.remaining_amount) || 0;
  const beachAccessTotal = Number(b.beach_access_fees);
  const beachAccessFees = Number.isFinite(beachAccessTotal) && beachAccessTotal > 0 ? beachAccessTotal : 0;
  const guestsTotal = Number(b.guests_total) || (Number(b.adults) || 0) + (Number(b.children) || 0) + (Number(b.nanny_count) || 0);
  const party = [
    b.adults > 0 ? `${b.adults} adult${b.adults === 1 ? '' : 's'}` : null,
    b.children > 0 ? `${b.children} child${b.children === 1 ? '' : 'ren'}` : null,
    b.nanny_count > 0 ? `${b.nanny_count} nanny` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-1 text-xs min-w-[13rem]">
      {b.nights > 0 && (
        <div className="text-gray-600">
          {b.nights} night{b.nights === 1 ? '' : 's'}
          {b.price_per_night > 0 ? ` · ${currency(b.price_per_night)}/night` : ''}
        </div>
      )}
      {party ? (
        <div className="text-gray-500">{party}</div>
      ) : (
        <div className="text-amber-700">Guests not recorded</div>
      )}
      {guestsTotal > 0 && (
        <div className="text-gray-400">{guestsTotal} guest{guestsTotal === 1 ? '' : 's'} total</div>
      )}
      <MoneyLine label="Accommodation" value={b.accommodation_amount} />
      <MoneyLine label="Beach access" value={beachAccessFees} showZero />
      <MoneyLine
        label={b.service_fee_percent ? `Service (${b.service_fee_percent}%)` : 'Service fees'}
        value={b.service_fees}
      />
      <MoneyLine label="Insurance" value={b.insurance} />
      <MoneyLine label="Security deposit" value={b.security_deposit} />
      {b.owner_collected_amount > 0 && (
        <MoneyLine
          label={`Owner collected${b.owner_collected_type ? ` (${b.owner_collected_type})` : ''}`}
          value={b.owner_collected_amount}
        />
      )}
      <div className="flex justify-between gap-3 border-t pt-1 mt-1">
        <span className="text-gray-500">Total (full bill)</span>
        <span className="font-medium tabular-nums">
          {reservationMoney(
            Number(b.full_bill_total ?? b.total_amount ?? row.total_amount) || 0,
            row
          )}
        </span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-gray-500">Paid</span>
        <span className="font-medium tabular-nums text-emerald-700">
          {reservationMoney(row.amount_paid, row)}
        </span>
      </div>
      <div className={`flex justify-between gap-3 border-t pt-1 font-semibold`}>
        <span className="text-amber-800">To collect</span>
        <span className="tabular-nums text-amber-900 font-bold">
          {reservationMoney(remaining, row)}
        </span>
      </div>
    </div>
  );
}

const BILL_FIELDS = [
  { key: 'accommodation_amount', label: 'Accommodation' },
  { key: 'beach_access_fees', label: 'Beach access' },
  { key: 'service_fees', label: 'Service fees' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'security_deposit', label: 'Security deposit' },
];

function seedBillDraft(row) {
  const b = row.payment_breakdown || {};
  const out = {};
  for (const f of BILL_FIELDS) {
    out[f.key] = String(Number(b[f.key]) || 0);
  }
  // Line items are the source of truth for the full bill. Only backfill accommodation
  // when price/night is missing but a stored total exceeds the other fee lines.
  const lineSum = sumBillDraft(out);
  const storedTotal = Number(b.full_bill_total ?? b.total_amount ?? row.total_amount) || 0;
  const accom = Number(out.accommodation_amount) || 0;
  if (accom <= 0 && storedTotal > lineSum + 0.5) {
    const withoutAcc = BILL_FIELDS.filter((f) => f.key !== 'accommodation_amount').reduce(
      (s, f) => s + (Number(out[f.key]) || 0),
      0
    );
    out.accommodation_amount = String(
      Math.max(0, Math.round((storedTotal - withoutAcc) * 100) / 100)
    );
  }
  return out;
}

function sumBillDraft(draft) {
  return BILL_FIELDS.reduce((sum, f) => sum + (Number(draft?.[f.key]) || 0), 0);
}

function BillEditFields({ draft, onChange }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">Edit bill</div>
      {BILL_FIELDS.map((f) => (
        <div key={f.key} className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-gray-600 shrink-0">{f.label}</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className="input text-sm py-1 w-[7.5rem] text-right tabular-nums"
            value={draft[f.key] ?? '0'}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

function CollectPaymentMethods({
  method,
  onMethodChange,
  isSplit,
  cashDraft,
  instapayDraft,
  onCashChange,
  onInstapayChange,
  currencyCode = 'EGP',
}) {
  return (
    <>
      <div>
        <label className="text-[10px] uppercase text-gray-500">How collected</label>
        <select className="input text-sm py-1.5" value={method} onChange={(e) => onMethodChange(e.target.value)}>
          <option value="cash">Cash</option>
          <option value="instapay">InstaPay</option>
          <option value="visa">Visa</option>
          <option value="split">Both (cash + InstaPay)</option>
        </select>
      </div>
      {isSplit ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase text-gray-500">Cash ({currencyCode})</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input text-sm py-1.5"
              value={cashDraft}
              onChange={(e) => onCashChange(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-gray-500">InstaPay ({currencyCode})</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input text-sm py-1.5"
              value={instapayDraft}
              onChange={(e) => onInstapayChange(e.target.value)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function CheckinsTodaySection({ embedded = false }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [range, setRange] = useState('month');
  const [collectingId, setCollectingId] = useState(null);
  const [collectModes, setCollectModes] = useState({});
  const [billDrafts, setBillDrafts] = useState({});
  const [methodDrafts, setMethodDrafts] = useState({});
  const [cashDrafts, setCashDrafts] = useState({});
  const [instapayDrafts, setInstapayDrafts] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [collectCommentDrafts, setCollectCommentDrafts] = useState({});
  const [collectCurrencyDrafts, setCollectCurrencyDrafts] = useState({});
  const isSupervisor =
    user?.role === 'admin' || user?.role === 'operations_supervisor';
  const isAgent = user?.role === 'operations';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ops-checkins-today', range],
    queryFn: async () => {
      const r = await api.get('/ops/checkins-today', { params: { range } });
      if (Array.isArray(r.data)) return { items: r.data, range };
      return {
        items: Array.isArray(r.data?.items) ? r.data.items : [],
        range: r.data?.range || range,
        from: r.data?.from,
        to: r.data?.to,
      };
    },
    refetchInterval: 20000,
  });
  const rows = data?.items || [];

  const invalidateCheckins = () => {
    qc.invalidateQueries({ queryKey: ['ops-checkins-today'] });
  };

  const collectMutation = useMutation({
    mutationFn: ({
      id,
      collect_mode,
      amount,
      payment_method,
      cash_amount,
      instapay_amount,
      bill,
      comment,
      currency: collectCurrency,
      exchange_rate,
    }) =>
      api.post(`/ops/checkins-today/${id}/collect`, {
        collect_mode,
        amount,
        payment_method,
        cash_amount,
        instapay_amount,
        bill,
        comment,
        currency: collectCurrency,
        exchange_rate,
      }),
    onSuccess: () => {
      toast.success('Money marked as collected');
      setCollectingId(null);
      qc.invalidateQueries({ queryKey: ['ops-checkins-today'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Collect failed'),
  });

  const commentMutation = useMutation({
    mutationFn: ({ id, comment }) =>
      api.post(`/ops/checkins-today/${id}/comment`, { comment }),
    onSuccess: () => {
      toast.success('Comment saved');
      invalidateCheckins();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save comment'),
  });

  const handoverMutation = useMutation({
    mutationFn: ({ id, comment }) =>
      api.post(`/ops/checkins-today/${id}/handover`, comment ? { comment } : {}),
    onSuccess: () => {
      toast.success('Unit handed to guest');
      invalidateCheckins();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Handover failed'),
  });

  const openCollect = (row) => {
    setCollectingId(row.id);
    setCollectModes((prev) => ({ ...prev, [row.id]: 'full' }));
    setBillDrafts((prev) => ({ ...prev, [row.id]: seedBillDraft(row) }));
    setMethodDrafts((prev) => ({ ...prev, [row.id]: prev[row.id] || 'cash' }));
    const code = reservationCurrencyCode(row);
    const rate = reservationRate(row);
    setCollectCurrencyDrafts((prev) => ({
      ...prev,
      [row.id]: {
        currency: code,
        exchange_rate: code === 'EGP' ? '' : String(rate),
      },
    }));
    const remainingEgp = Number(row.remaining_amount) || 0;
    const remainingForeign = foreignFromEgp(remainingEgp, code === 'EGP' ? 1 : rate);
    const half = Math.round(remainingForeign * 50) / 100;
    setCashDrafts((prev) => ({ ...prev, [row.id]: String(half) }));
    setInstapayDrafts((prev) => ({
      ...prev,
      [row.id]: String(Math.round((remainingForeign - half) * 100) / 100),
    }));
  };

  const syncSplitForAmount = (id, total) => {
    const half = Math.round((Number(total) || 0) * 50) / 100;
    setCashDrafts((prev) => ({ ...prev, [id]: String(half) }));
    setInstapayDrafts((prev) => ({
      ...prev,
      [id]: String(Math.round(((Number(total) || 0) - half) * 100) / 100),
    }));
  };

  const collectFx = (row) => {
    const draft = collectCurrencyDrafts[row.id] || {
      currency: reservationCurrencyCode(row),
      exchange_rate: '',
    };
    const code = String(draft.currency || 'EGP').toUpperCase();
    const rate =
      code === 'EGP' ? 1 : Number(draft.exchange_rate) > 0 ? Number(draft.exchange_rate) : reservationRate(row);
    return { currency: code, exchange_rate: rate };
  };

  if (isLoading) return <LoadingSpinner />;

  const emptyLabel =
    range === 'today'
      ? 'today'
      : range === 'tomorrow'
        ? 'tomorrow'
        : range === 'week'
          ? 'this week'
          : 'this month';

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded ? (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Check-ins</h1>
            <p className="mt-1 text-sm text-gray-500">
              {isAgent
                ? 'Check-ins on your units — collect the remaining balance, add a comment, then hand over.'
                : 'Each agent sees the check-ins for the units assigned to them.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <OpsDateRangeFilter value={range} onChange={setRange} />
            <button type="button" className="btn-secondary text-sm" onClick={() => refetch()}>
              Refresh
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <OpsDateRangeFilter value={range} onChange={setRange} />
          <button type="button" className="btn-secondary text-sm" onClick={() => refetch()}>
            Refresh
          </button>
        </div>
      )}

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load check-ins: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          {isAgent
            ? `No check-ins on your units for ${emptyLabel}.`
            : `No check-ins scheduled for ${emptyLabel}.`}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Guest</th>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Payment details</th>
                {isSupervisor ? <th className="py-3 px-4">Agent</th> : null}
                <th className="py-3 px-4">Money collected</th>
                {isAgent ? <th className="py-3 px-4">Check-in comment</th> : null}
                <th className="py-3 px-4">Handover</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const remainingEgp = Number(r.remaining_amount) || 0;
                const paid = Number(r.amount_paid) || 0;
                const mode = collectModes[r.id] || 'full';
                const isCustom = mode === 'custom';
                const billDraft = billDrafts[r.id] || seedBillDraft(r);
                const finalBill = Math.round(sumBillDraft(billDraft) * 100) / 100;
                const customRemainingEgp = Math.max(0, Math.round((finalBill - paid) * 100) / 100);
                const collectAmountEgp = isCustom ? customRemainingEgp : remainingEgp;
                const fx = collectFx(r);
                const collectAmount = foreignFromEgp(collectAmountEgp, fx.exchange_rate);
                const remaining = remainingEgp;
                const customRemaining = customRemainingEgp;
                const method = methodDrafts[r.id] || 'cash';
                const isSplit = method === 'split';
                const cashDraft =
                  cashDrafts[r.id] != null
                    ? cashDrafts[r.id]
                    : String(Math.round(collectAmount * 50) / 100);
                const instapayDraft =
                  instapayDrafts[r.id] != null
                    ? instapayDrafts[r.id]
                    : String(
                        Math.round((collectAmount - (Number(cashDraft) || 0)) * 100) / 100
                      );
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-4 px-4 whitespace-nowrap">
                      <div className="font-semibold text-gray-900">{formatOpsDay(r.check_in)}</div>
                      <div className="text-[11px] text-gray-500 tabular-nums">
                        {String(r.check_in || '').slice(0, 10)}
                      </div>
                    </td>
                    <td className="py-4 px-4 min-w-[12rem]">
                      <div className="font-semibold text-gray-900">{r.guest_name || '—'}</div>
                      <div className="text-xs text-gray-600 tabular-nums mt-0.5">
                        {r.guest_phone || 'No phone'}
                      </div>
                    </td>
                    <td className="py-4 px-4 min-w-[9rem]">
                      <div className="font-semibold text-gray-900">{r.unit_number || '—'}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[10rem]">
                        {r.unit_title || r.project || ''}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <PaymentDetails row={r} />
                    </td>
                    {isSupervisor ? (
                      <td className="py-4 px-4 min-w-[10rem] text-sm text-gray-800">
                        {r.ops_assignee_name || 'No agent on this unit'}
                      </td>
                    ) : null}
                    <td className="py-4 px-4 min-w-[16rem]">
                      {r.ops_money_collected ? (
                        <div className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-semibold">
                          <CheckCircle2 className="w-4 h-4" />
                          Collected
                          {r.ops_money_collected_amount > 0
                            ? ` (${reservationMoney(r.ops_money_collected_amount, r)})`
                            : remaining <= 0.5
                              ? ' (already paid)'
                              : ''}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                            <input
                              type="checkbox"
                              checked={collectingId === r.id}
                              onChange={(e) => {
                                if (e.target.checked) openCollect(r);
                                else setCollectingId(null);
                              }}
                            />
                            Collect
                          </label>
                          {collectingId === r.id ? (
                            <div className="space-y-2.5 rounded-lg border bg-gray-50 p-2.5">
                              <ReservationCurrencyPicker
                                form={
                                  collectCurrencyDrafts[r.id] || {
                                    currency: reservationCurrencyCode(r),
                                    exchange_rate:
                                      reservationCurrencyCode(r) === 'EGP'
                                        ? ''
                                        : String(reservationRate(r)),
                                  }
                                }
                                setForm={(updater) => {
                                  setCollectCurrencyDrafts((prev) => {
                                    const cur =
                                      prev[r.id] || {
                                        currency: reservationCurrencyCode(r),
                                        exchange_rate:
                                          reservationCurrencyCode(r) === 'EGP'
                                            ? ''
                                            : String(reservationRate(r)),
                                      };
                                    const next = typeof updater === 'function' ? updater(cur) : updater;
                                    const nextRate =
                                      next.currency === 'EGP'
                                        ? 1
                                        : Number(next.exchange_rate) > 0
                                          ? Number(next.exchange_rate)
                                          : reservationRate(r);
                                    const nextCollect = foreignFromEgp(
                                      isCustom ? customRemainingEgp : remainingEgp,
                                      nextRate
                                    );
                                    syncSplitForAmount(r.id, nextCollect);
                                    return { ...prev, [r.id]: next };
                                  });
                                }}
                                currencies={MONEY_CURRENCIES}
                                inputClass="input text-sm py-1.5"
                                labelClass="text-[10px] uppercase text-gray-500"
                              />
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  className={`text-xs py-1.5 rounded-md border font-semibold ${
                                    !isCustom
                                      ? 'bg-ch-pine text-white border-ch-pine'
                                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                                  }`}
                                  onClick={() => {
                                    setCollectModes((prev) => ({ ...prev, [r.id]: 'full' }));
                                    syncSplitForAmount(r.id, foreignFromEgp(remainingEgp, fx.exchange_rate));
                                  }}
                                >
                                  Full amount
                                </button>
                                <button
                                  type="button"
                                  className={`text-xs py-1.5 rounded-md border font-semibold ${
                                    isCustom
                                      ? 'bg-ch-pine text-white border-ch-pine'
                                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                                  }`}
                                  onClick={() => {
                                    setCollectModes((prev) => ({ ...prev, [r.id]: 'custom' }));
                                    const seeded = billDrafts[r.id] || seedBillDraft(r);
                                    setBillDrafts((prev) => ({ ...prev, [r.id]: seeded }));
                                    const nextRemainingEgp = Math.max(
                                      0,
                                      Math.round((sumBillDraft(seeded) - paid) * 100) / 100
                                    );
                                    syncSplitForAmount(
                                      r.id,
                                      foreignFromEgp(nextRemainingEgp, fx.exchange_rate)
                                    );
                                  }}
                                >
                                  Custom bill
                                </button>
                              </div>

                              {isCustom ? (
                                <>
                                  <BillEditFields
                                    draft={billDraft}
                                    onChange={(key, value) => {
                                      setBillDrafts((prev) => {
                                        const next = {
                                          ...(prev[r.id] || seedBillDraft(r)),
                                          [key]: value,
                                        };
                                        const nextRemainingEgp = Math.max(
                                          0,
                                          Math.round((sumBillDraft(next) - paid) * 100) / 100
                                        );
                                        if (isSplit) {
                                          syncSplitForAmount(
                                            r.id,
                                            foreignFromEgp(nextRemainingEgp, fx.exchange_rate)
                                          );
                                        }
                                        return { ...prev, [r.id]: next };
                                      });
                                    }}
                                  />
                                  <div className="space-y-1 text-xs border-t pt-2">
                                    <div className="flex justify-between gap-2">
                                      <span className="text-gray-500">Final bill</span>
                                      <span className="font-semibold tabular-nums">
                                        {currency(finalBill)}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                      <span className="text-gray-500">Already paid</span>
                                      <span className="tabular-nums text-emerald-700">
                                        {currency(paid)}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-2 font-semibold text-amber-900">
                                      <span>To collect ({fx.currency})</span>
                                      <span className="tabular-nums">
                                        {currency(collectAmount, fx.currency)}
                                      </span>
                                    </div>
                                    {fx.currency !== 'EGP' ? (
                                      <div className="flex justify-between gap-2 text-gray-500">
                                        <span>≈ EGP</span>
                                        <span className="tabular-nums">{currency(customRemainingEgp)}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                  <label className="block text-xs space-y-1">
                                    <span className="text-gray-600 font-medium">
                                      Comment (required for bill edits)
                                    </span>
                                    <textarea
                                      className="input text-sm py-1.5 min-h-[4rem]"
                                      value={collectCommentDrafts[r.id] || ''}
                                      onChange={(e) =>
                                        setCollectCommentDrafts((prev) => ({
                                          ...prev,
                                          [r.id]: e.target.value,
                                        }))
                                      }
                                      placeholder="Why was the bill changed?"
                                    />
                                  </label>
                                </>
                              ) : (
                                <div className="text-xs text-gray-700">
                                  Collect full remaining:{' '}
                                  <span className="font-semibold tabular-nums text-amber-900">
                                    {currency(collectAmount, fx.currency)}
                                  </span>
                                  {fx.currency !== 'EGP' ? (
                                    <span className="text-gray-500"> (≈ {currency(remainingEgp)})</span>
                                  ) : null}
                                </div>
                              )}

                              <CollectPaymentMethods
                                method={method}
                                onMethodChange={(next) => {
                                  setMethodDrafts((prev) => ({ ...prev, [r.id]: next }));
                                  if (next === 'split') syncSplitForAmount(r.id, collectAmount);
                                }}
                                isSplit={isSplit}
                                cashDraft={cashDraft}
                                instapayDraft={instapayDraft}
                                onCashChange={(v) =>
                                  setCashDrafts((prev) => ({ ...prev, [r.id]: v }))
                                }
                                onInstapayChange={(v) =>
                                  setInstapayDrafts((prev) => ({ ...prev, [r.id]: v }))
                                }
                                currencyCode={fx.currency}
                              />

                              <button
                                type="button"
                                className="btn-primary text-xs w-full justify-center"
                                disabled={collectMutation.isPending}
                                onClick={() => {
                                  const amount = Number(collectAmount);
                                  if (!Number.isFinite(amount) || amount < 0) {
                                    toast.error('Invalid collect amount');
                                    return;
                                  }
                                  if (fx.currency !== 'EGP' && !(fx.exchange_rate > 0)) {
                                    toast.error(`Enter the ${fx.currency} exchange rate (EGP per 1 ${fx.currency})`);
                                    return;
                                  }
                                  if (isCustom && finalBill + 0.5 < paid) {
                                    toast.error('Final bill cannot be less than already paid');
                                    return;
                                  }
                                  const comment = String(collectCommentDrafts[r.id] || '').trim();
                                  if (isCustom && !comment) {
                                    toast.error('Add a comment explaining the bill edit');
                                    return;
                                  }

                                  const bill = isCustom
                                    ? Object.fromEntries(
                                        BILL_FIELDS.map((f) => [
                                          f.key,
                                          Math.round((Number(billDraft[f.key]) || 0) * 100) / 100,
                                        ])
                                      )
                                    : undefined;

                                  const fxPayload = {
                                    currency: fx.currency,
                                    exchange_rate: fx.currency === 'EGP' ? 1 : fx.exchange_rate,
                                  };

                                  if (isSplit) {
                                    const cash = Number(cashDraft) || 0;
                                    const instapay = Number(instapayDraft) || 0;
                                    if (cash <= 0 && instapay <= 0) {
                                      toast.error('Enter cash and/or InstaPay amounts');
                                      return;
                                    }
                                    if (Math.abs(cash + instapay - amount) > 0.05) {
                                      toast.error('Cash + InstaPay must equal the amount to collect');
                                      return;
                                    }
                                    collectMutation.mutate({
                                      id: r.id,
                                      collect_mode: mode,
                                      amount,
                                      cash_amount: cash,
                                      instapay_amount: instapay,
                                      bill,
                                      comment: comment || undefined,
                                      ...fxPayload,
                                    });
                                    return;
                                  }
                                  collectMutation.mutate({
                                    id: r.id,
                                    collect_mode: mode,
                                    amount,
                                    payment_method: method,
                                    bill,
                                    comment: comment || undefined,
                                    ...fxPayload,
                                  });
                                }}
                              >
                                Confirm collect
                                {collectAmount > 0
                                  ? ` · ${currency(collectAmount, fx.currency)}`
                                  : ''}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </td>
                    {isAgent ? (
                      <td className="py-4 px-4 min-w-[16rem]">
                        {r.ops_handed_over ? (
                          <div className="text-xs text-gray-700 whitespace-pre-wrap">
                            {r.ops_handover_comment || '—'}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <textarea
                              className="input text-sm min-h-[4.5rem] resize-y"
                              placeholder="Comment before handover (required)"
                              value={
                                commentDrafts[r.id] != null
                                  ? commentDrafts[r.id]
                                  : r.ops_handover_comment || ''
                              }
                              onChange={(e) =>
                                setCommentDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="btn-secondary text-xs w-full justify-center"
                              disabled={commentMutation.isPending}
                              onClick={() => {
                                const comment =
                                  commentDrafts[r.id] != null
                                    ? commentDrafts[r.id]
                                    : r.ops_handover_comment || '';
                                if (!String(comment).trim()) {
                                  toast.error('Write a comment first');
                                  return;
                                }
                                commentMutation.mutate({ id: r.id, comment: String(comment).trim() });
                              }}
                            >
                              Save comment
                            </button>
                          </div>
                        )}
                      </td>
                    ) : null}
                    <td className="py-4 px-4 min-w-[9rem]">
                      {r.ops_handed_over ? (
                        <span className="inline-flex items-center gap-1.5 text-ch-pine text-xs font-semibold">
                          <KeyRound className="w-4 h-4" /> Handed over
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={!r.can_handover || handoverMutation.isPending}
                          title={
                            !r.ops_money_collected
                              ? 'Collect money first'
                              : isAgent
                                ? 'Add a comment, then give unit to guest'
                                : 'Give unit to guest'
                          }
                          onClick={() => {
                            const comment =
                              commentDrafts[r.id] != null
                                ? String(commentDrafts[r.id]).trim()
                                : String(r.ops_handover_comment || '').trim();
                            if (isAgent && !comment) {
                              toast.error('Add a check-in comment before handover');
                              return;
                            }
                            handoverMutation.mutate({
                              id: r.id,
                              comment: isAgent ? comment : undefined,
                            });
                          }}
                        >
                          Give to guest
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function OpsCheckinsToday() {
  return <CheckinsTodaySection />;
}
