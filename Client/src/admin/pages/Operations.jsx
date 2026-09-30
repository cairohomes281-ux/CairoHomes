import { useSearchParams } from 'react-router-dom';
import { KeyRound, History, MessageSquareText, LogOut, SprayCan, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { canAccess } from '../utils/permissions';
import { CheckinsTodaySection } from './OpsCheckinsToday';
import { CheckinsHistorySection } from './OpsCheckinsHistory';
import { CheckinCommentsSection } from './OpsCheckinComments';
import { CheckoutsTodaySection } from './OpsCheckoutsToday';
import { TodayCleansSection } from './HkTodayCleans';
import { CleansHistorySection } from './HkCleansHistory';
import { UnitCleansSummarySection } from './HkUnitCleansSummary';

const TABS = [
  { id: 'today', label: 'Check-ins', icon: KeyRound, page: 'ops_checkins' },
  { id: 'checkouts', label: 'Checkouts', icon: LogOut, page: 'ops_checkins' },
  { id: 'cleans', label: "Today's cleans", icon: SprayCan, page: 'hk_today' },
  { id: 'cleans-history', label: 'Cleans history', icon: History, page: 'hk_today' },
  { id: 'unit-cleans', label: 'Unit cleans', icon: Building2, page: 'hk_today' },
  { id: 'history', label: 'Check-ins history', icon: History, page: 'ops_checkins' },
  { id: 'comments', label: 'Check-in comments', icon: MessageSquareText, page: 'ops_comments' },
];

const TAB_ALIASES = {
  today: 'today',
  'checkins-today': 'today',
  checkouts: 'checkouts',
  'checkouts-today': 'checkouts',
  cleans: 'cleans',
  'today-cleans': 'cleans',
  'cleans-history': 'cleans-history',
  'unit-cleans': 'unit-cleans',
  'units-cleans': 'unit-cleans',
  history: 'history',
  'checkins-history': 'history',
  comments: 'comments',
  'checkin-comments': 'comments',
};

export default function Operations() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'today';
  const activeTab = TAB_ALIASES[rawTab] || 'today';

  const visibleTabs = TABS.filter((tab) => canAccess(user, tab.page));
  const resolvedTab = visibleTabs.some((t) => t.id === activeTab)
    ? activeTab
    : visibleTabs[0]?.id || 'today';

  function setTab(id) {
    setSearchParams({ tab: id }, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Operations</h1>
        <p className="page-subtitle">
          Check-ins, checkouts, cleans, history, and agent comments — filter by today, tomorrow, this
          week, or this month
        </p>
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const active = resolvedTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-ch-pine shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {resolvedTab === 'today' ? <CheckinsTodaySection embedded /> : null}
      {resolvedTab === 'checkouts' ? <CheckoutsTodaySection embedded /> : null}
      {resolvedTab === 'cleans' ? <TodayCleansSection embedded /> : null}
      {resolvedTab === 'cleans-history' ? <CleansHistorySection embedded /> : null}
      {resolvedTab === 'unit-cleans' ? <UnitCleansSummarySection embedded /> : null}
      {resolvedTab === 'history' ? <CheckinsHistorySection embedded /> : null}
      {resolvedTab === 'comments' ? <CheckinCommentsSection embedded /> : null}
    </div>
  );
}
