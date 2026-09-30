import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import PayslipDetail, { PAYSLIP_MONTHS } from '../components/PayslipDetail';
import { useAuth } from '../context/AuthContext';

function currentPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export default function Payslip() {
  const { user } = useAuth();
  const initial = currentPeriod();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const years = Array.from({ length: 6 }, (_, i) => initial.year - 2 + i);

  const { data, isLoading } = useQuery({
    queryKey: ['hr-payslip', year, month],
    queryFn: () => api.get('/hr/payslip', { params: { year, month } }).then((r) => r.data),
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ch-muted">Payroll</p>
          <h1 className="page-title mt-1">Payslip</h1>
          <p className="page-subtitle">Your base salary, bonuses, penalties, deductions, and net for the month.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {PAYSLIP_MONTHS.map((label, i) => (
              <option key={label} value={i + 1}>{label}</option>
            ))}
          </select>
          <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !data ? (
        <div className="card text-sm text-ch-muted">Could not load this payslip.</div>
      ) : (
        <div className="card">
          <PayslipDetail data={data} year={year} month={month} fallbackName={user?.full_name} />
        </div>
      )}
    </div>
  );
}
