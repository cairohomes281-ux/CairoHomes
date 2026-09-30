import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileBarChart2, Download, Printer, Info, Building2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import { currency, formatDate, unitSelectLabel } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';
import SearchableSelect from '../components/ui/SearchableSelect';
import { isOwnerRole as checkOwner } from '../utils/permissions';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';


function ModeBadge({ mode }) {
  const cfg = {
    A: { label: 'Fixed %',  cls: 'bg-blue-100 text-blue-700' },
    B: { label: 'Split %',  cls: 'bg-purple-100 text-purple-700' },
    C: { label: 'Advanced', cls: 'bg-amber-100 text-amber-700' },
  }[String(mode).toUpperCase()] || { label: mode, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}


function SummaryRow({ label, value, sub, negative, bold, separator, green, large }) {
  return (
    <div className={`flex justify-between items-center gap-8 py-1.5 text-sm
      ${separator ? 'border-t border-gray-200 mt-2 pt-3' : ''}`}>
      <span className={`flex items-center gap-1.5 ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
        {label}
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </span>
      <span className={`font-semibold tabular-nums text-right
        ${large    ? 'text-lg'           : ''}
        ${green    ? 'text-green-700'    :
          negative ? 'text-red-600'      :
          bold     ? 'text-primary-700'  :
                     'text-gray-800'}`}>
        {value}
      </span>
    </div>
  );
}


function PaidByBadge({ paidBy }) {
  return paidBy === 'owner'
    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Owner</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Company</span>;
}

export default function OwnerStatement() {
  const { user } = useAuth();
  const isOwnerRole  = checkOwner(user);
  const isStaffRole  = !isOwnerRole;

  const [unitId,    setUnitId]    = useState('');
  const [fromDate,  setFromDate]  = useState(FINANCIAL_EPOCH);
  const [toDate,    setToDate]    = useState('');
  const [generated, setGenerated] = useState(false);

  
  const { data: units = [], isLoading: unitsLoading } = useQuery({
    queryKey: ['owner-statement-units', isOwnerRole],
    queryFn: () => isOwnerRole
      ? api.get('/owner/units').then(r => r.data)
      : api.get('/units').then(r => r.data),
  });

  
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['owner-statement', unitId, fromDate, toDate],
    queryFn: () =>
      api.get('/reports/owner-statement', {
        params: {
          unit_id: unitId,
          from_date: fromDate,
          to_date: toDate || undefined,
        },
      }).then(r => r.data),
    enabled: false,
  });

  const handleGenerate = () => {
    if (!unitId || !fromDate) {
      alert('Please select a unit and from date');
      return;
    }
    setGenerated(true);
    refetch();
  };

  const [pdfLoading, setPdfLoading] = useState(false);

  const handlePdfDownload = async () => {
    setPdfLoading(true);
    try {
      const token = localStorage.getItem('pms_token') || '';
      const res = await fetch(
        `/api/pms/reports/export/owner-statement/pdf?unit_id=${unitId}&from_date=${fromDate}&to_date=${toDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const blob = await res.blob();
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `Owner_Statement_${fromDate}_to_${toDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
      toast.error('Failed to generate PDF. Please try again.');
    } finally {
      setPdfLoading(false);
    }
  };

  const s    = data?.summary;
  const mode = s?.commissionMode || 'A';
  const commissionPct = s?.companyCommissionPct || 0;

  
  const allExpenses    = data?.expenses || [];
  const ownerExpenses  = allExpenses.filter(e => e.paid_by === 'owner');
  const companyExpenses = allExpenses.filter(e => e.paid_by === 'company');
  const ownerExpTotal  = ownerExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const companyExpTotal = companyExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Owner Statement</h1>
        <p className="page-subtitle">
          {isOwnerRole ? 'View your property financial statement' : 'Generate financial statements for any unit'}
        </p>
      </div>

      
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-primary-600" />
          Statement Parameters
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="label">Unit *</label>
            <SearchableSelect value={unitId} onChange={v => { setUnitId(v); setGenerated(false); }}
              placeholder={unitsLoading ? 'Loading units…' : 'Select unit…'}
              disabled={unitsLoading}
              options={[{ value: '', label: unitsLoading ? 'Loading units…' : 'Select unit…' }, ...units.map(u => ({ value: String(u.id), label: unitSelectLabel(u) }))]}
            />
          </div>
          <div>
            <label className="label">From Date *</label>
            <input
              type="date"
              className="input"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setGenerated(false); }}
            />
          </div>
          <div>
            <label className="label">To Date *</label>
            <input
              type="date"
              className="input"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setGenerated(false); }}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleGenerate}
              disabled={!unitId || !fromDate}
              className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Generate Statement
            </button>
          </div>
        </div>
      </div>

      {isLoading && generated && <LoadingSpinner />}

      {data && generated && (
        <div className="space-y-5" id="statement-print">

          
          <div className="card bg-gradient-to-r from-primary-900 to-primary-700 text-white">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-2xl font-bold">Owner Statement</h2>
                <p className="text-blue-200 mt-1 font-medium">
                  {data.unit?.name} — {data.unit?.project}
                </p>
                <p className="text-blue-300 text-sm mt-1">
                  Period: {formatDate(fromDate)}
                  {toDate ? ` → ${formatDate(toDate)}` : ' → present'}
                </p>
                {data.unit?.owner_name && (
                  <p className="text-blue-300 text-sm">
                    Owner: <span className="text-white font-medium">{data.unit.owner_name}</span>
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => window.print()}
                  className="btn btn-sm bg-white/20 text-white hover:bg-white/30 flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />Print
                </button>
                {user?.role === 'admin' && (
                  <button
                    onClick={handlePdfDownload}
                    disabled={pdfLoading}
                    className="btn btn-sm bg-white/20 text-white hover:bg-white/30 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                    {pdfLoading ? 'Generating…' : 'PDF'}
                  </button>
                )}
              </div>
            </div>
          </div>

          
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">
              Reservations
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({data.reservations?.length || 0} booking{data.reservations?.length !== 1 ? 's' : ''})
              </span>
            </h3>

            {data.reservations?.length > 0 ? (
              <div className="table-wrapper">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>Check-in</th>
                      <th>Check-out</th>
                      <th className="text-center">Nights</th>
                      <th className="text-right">Price / Night</th>
                      <th className="text-right">Subtotal</th>
                      <th className="text-right">Commission</th>
                      <th className="text-right font-bold">Owner Net</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reservations.map(r => {
                      const pricePerNight = parseFloat(r.intermediate_price_per_night) || 0;
                      const subtotal      = parseFloat(r.subtotal)                     || 0;
                      const commission    = parseFloat(r.company_commission_amount)    || 0;
                      const ownerNet      = parseFloat(r.adjusted_total)              || 0;
                      const appliedPct    = parseFloat(r.applied_commission_pct)      || 0;

                      return (
                        <tr key={r.id}>
                          <td className="text-gray-400 text-xs">#{r.id}</td>
                          <td className="whitespace-nowrap">{formatDate(r.check_in)}</td>
                          <td className="whitespace-nowrap">{formatDate(r.check_out)}</td>
                          <td className="text-center">{r.nights}</td>

                          
                          <td className="text-right tabular-nums">
                            {currency(pricePerNight)}
                          </td>

                          
                          <td className="text-right tabular-nums text-gray-700">
                            {currency(subtotal)}
                          </td>

                          
                          <td className="text-right tabular-nums">
                            {commission > 0 ? (
                              <span className="text-red-500">
                                − {currency(commission)}
                                {appliedPct > 0 && (
                                  <span className="text-xs text-gray-400 ml-1">({appliedPct}%)</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>

                          
                          <td className="text-right tabular-nums font-bold text-primary-700">
                            {currency(ownerNet)}
                          </td>

                          
                          <td>
                            {r.is_owner_reservation
                              ? <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Owner</span>
                              : <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Sales</span>
                            }
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-400 text-sm py-8 text-center">
                No reservations found in this period
              </p>
            )}

            
            {data.reservations?.length > 0 && (
              <div className="mt-6 ml-auto max-w-sm border border-gray-100 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-5 py-4 space-y-1">
                  <SummaryRow
                    label="Total Revenue"
                    sub="(after deductions)"
                    value={currency(s?.totalSubtotal)}
                  />
                  <SummaryRow
                    label="Company Commission"
                    sub={commissionPct > 0 ? `(${commissionPct}%)` : ''}
                    value={s?.totalCompanyCommission > 0
                      ? `− ${currency(s.totalCompanyCommission)}`
                      : currency(0)}
                    negative={s?.totalCompanyCommission > 0}
                  />
                </div>
                <div className="bg-primary-50 px-5 py-3 border-t border-primary-100">
                  <SummaryRow
                    label="Owner Net"
                    value={currency(s?.totalOwnerNet)}
                    bold
                    green
                  />
                </div>
              </div>
            )}
          </div>

          
          {allExpenses.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">
                  Expenses
                  <span className="ml-2 text-sm font-normal text-gray-400">
                    ({allExpenses.length} item{allExpenses.length !== 1 ? 's' : ''})
                  </span>
                </h3>
                
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  {ownerExpenses.length > 0 && (
                    <span>
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
                      Owner: <strong className="text-gray-700">{currency(ownerExpTotal)}</strong>
                    </span>
                  )}
                  {companyExpenses.length > 0 && (
                    <span>
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />
                      Company: <strong className="text-gray-700">{currency(companyExpTotal)}</strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="table-wrapper">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="text-right">Amount</th>
                      <th className="text-center">Paid By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allExpenses.map(e => (
                      <tr key={e.id} className={e.paid_by === 'owner' ? 'bg-amber-50/40' : ''}>
                        <td className="whitespace-nowrap">{formatDate(e.expense_date)}</td>
                        <td>{e.description}</td>
                        <td className={`text-right tabular-nums font-semibold ${e.paid_by === 'owner' ? 'text-amber-700' : 'text-blue-700'}`}>
                          {currency(e.amount)}
                        </td>
                        <td className="text-center">
                          <PaidByBadge paidBy={e.paid_by} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {allExpenses.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={2} className="font-semibold text-gray-700 text-right pr-4">Total Expenses</td>
                        <td className="text-right tabular-nums font-bold text-gray-800">
                          {currency(ownerExpTotal + companyExpTotal)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          
          {allExpenses.length === 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-3">Expenses</h3>
              <p className="text-gray-400 text-sm py-4 text-center">No expenses recorded in this period</p>
            </div>
          )}

          
          <div className="card bg-gray-50 border-2 border-primary-200">
            <h3 className="font-semibold text-gray-900 mb-5">Final Summary</h3>

            <div className="max-w-sm ml-auto space-y-0.5">
              
              <SummaryRow
                label="Total Revenue"
                sub="(after deductions)"
                value={currency(s?.totalSubtotal)}
              />

              
              {(s?.totalCompanyCommission || 0) > 0 && (
                <SummaryRow
                  label="Company Commission"
                  sub={commissionPct > 0 ? `(${commissionPct}%)` : ''}
                  value={`− ${currency(s.totalCompanyCommission)}`}
                  negative
                />
              )}

              
              <SummaryRow
                label="Owner Net Revenue"
                value={currency(s?.totalOwnerNet)}
                green
                separator
              />

              
              {ownerExpTotal > 0 && (
                <SummaryRow
                  label="Owner Expenses"
                  value={`− ${currency(ownerExpTotal)}`}
                  negative
                />
              )}

              
              <div className="bg-white rounded-xl px-5 py-4 mt-3 border border-primary-100">
                <SummaryRow
                  label="Final Amount Due to Owner"
                  value={currency(s?.finalDue)}
                  bold
                  large
                  green={s?.finalDue >= 0}
                  negative={s?.finalDue < 0}
                />
              </div>

              
              {isStaffRole && (
                <details className="mt-5">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600
                    flex items-center gap-1 select-none">
                    <Info className="w-3 h-3" />
                    View full deduction breakdown (internal only)
                  </summary>
                  <div className="mt-3 bg-white rounded-xl border border-gray-100 px-5 py-4 space-y-0.5">
                    <SummaryRow
                      label="Gross Revenue"
                      sub="(tenant payments)"
                      value={currency(s?.totalGross)}
                    />
                    {s?.totalUtilitiesDeduction > 0 && (
                      <SummaryRow
                        label="Utilities Deduction"
                        value={`− ${currency(s.totalUtilitiesDeduction)}`}
                        negative
                      />
                    )}
                    {s?.totalBrokerDeduction > 0 && (
                      <SummaryRow
                        label="Broker Deduction"
                        value={`− ${currency(s.totalBrokerDeduction)}`}
                        negative
                      />
                    )}
                    {s?.totalTenantDeduction > 0 && (
                      <SummaryRow
                        label="Tenant Commission"
                        sub={s?.tenantCommissionPct > 0 ? `(${s.tenantCommissionPct}%)` : ''}
                        value={`− ${currency(s.totalTenantDeduction)}`}
                        negative
                      />
                    )}
                    <SummaryRow
                      label="Subtotal"
                      sub="(base for commission)"
                      value={currency(s?.totalSubtotal)}
                      separator
                    />
                    {s?.totalCompanyCommission > 0 && (
                      <SummaryRow
                        label="Company Commission"
                        sub={s.commissionLabel ? `(${s.commissionLabel})` : ''}
                        value={`− ${currency(s.totalCompanyCommission)}`}
                        negative
                      />
                    )}
                    <SummaryRow
                      label="Owner Net"
                      value={currency(s?.totalOwnerNet)}
                      separator
                      bold
                      green
                    />
                    {companyExpTotal > 0 && (
                      <SummaryRow
                        label="Company Expenses"
                        sub="(internal, not deducted from owner)"
                        value={currency(companyExpTotal)}
                      />
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>

        </div>
      )}

      {!generated && (
        <EmptyState
          icon={FileBarChart2}
          title="No statement generated"
          subtitle="Select a unit and date range above, then click Generate Statement"
        />
      )}
    </div>
  );
}
