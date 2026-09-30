import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Banknote, History, Home, Inbox } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  canRequestLoan,
  canRequestStaffBenefits,
  canRequestWfh,
  canSeeRequestHistory,
  canSeeRequestQueue,
} from '../utils/permissions';
import HolidayRequests from './HolidayRequests';
import WorkFromHome from './WorkFromHome';
import Loans from './Loans';
import RequestsHistory from './RequestsHistory';

const TYPE_TABS = [
  { id: 'holiday', label: 'Holiday', icon: Inbox, pageHint: 'holiday' },
  { id: 'wfh', label: 'Work from home', icon: Home, pageHint: 'wfh' },
  { id: 'loans', label: 'Loans', icon: Banknote, pageHint: 'loans' },
  { id: 'history', label: 'Requests history', icon: History, pageHint: 'history' },
];

export default function Requests() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canQueue = canSeeRequestQueue(user);
  const canHistory = canSeeRequestHistory(user);
  const canRequestHoliday = canRequestStaffBenefits(user);
  const canAskLoan = canRequestLoan(user);
  const canRequestWfhDay = canRequestWfh(user);

  const visibleTabs = useMemo(
    () =>
      TYPE_TABS.filter((tab) => {
        if (tab.id === 'holiday') return canRequestHoliday || canQueue;
        if (tab.id === 'wfh') return canRequestWfhDay || canQueue;
        if (tab.id === 'loans') return canAskLoan || canQueue;
        if (tab.id === 'history') return canHistory;
        return false;
      }),
    [canQueue, canHistory, canRequestHoliday, canAskLoan, canRequestWfhDay]
  );

  const rawType = searchParams.get('type') || visibleTabs[0]?.id || 'holiday';
  const activeType = visibleTabs.some((t) => t.id === rawType)
    ? rawType
    : visibleTabs[0]?.id || 'holiday';

  function setType(id) {
    const next = new URLSearchParams(searchParams);
    next.set('type', id);
    if (id !== 'holiday') next.delete('view');
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ch-muted">HR</p>
        <h1 className="page-title mt-1">Requests</h1>
        <p className="page-subtitle">
          Holiday and WFH need your manager then the HR Manager. Loans need the HR Manager
          then the Financial Manager
          {canHistory ? '. History shows past and current requests for your team or the company.' : '.'}
        </p>
      </div>

      {visibleTabs.length > 1 ? (
        <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setType(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white text-ch-pine shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {activeType === 'holiday' ? <HolidayRequests embedded /> : null}
      {activeType === 'wfh' ? <WorkFromHome embedded /> : null}
      {activeType === 'loans' ? <Loans embedded /> : null}
      {activeType === 'history' ? <RequestsHistory /> : null}
    </div>
  );
}
