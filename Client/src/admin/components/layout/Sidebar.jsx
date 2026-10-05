import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { roleLabel, pmsLabel, canSeeRequestQueue } from '../../utils/permissions';
import {
  countActionableRequests,
  useAcknowledgedRequestIds,
} from '../../utils/requestAcknowledgements';
import { getRoleTheme } from '../../utils/roleTheme';
import { LogoMark } from '../../../components/brand/Logo';
import api from '../../api/axios';
import {
  LayoutDashboard, Building2, CalendarDays,
  Users, UserCircle,
  LogOut, Building, CalendarRange,
  Briefcase, Tag, KeyRound,
  Link2,
  Landmark,
  Wallet,
  MinusCircle,
  Inbox,
  ClipboardList,
  Clock,
  ShieldCheck,
  Receipt,
  FileBarChart2,
  Trophy,
  ListTodo,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { path: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, page: 'dashboard' },
      { path: '/admin/tasks', label: 'Tasks', icon: ListTodo, page: 'tasks', excludeRoles: ['hr', 'hr_supervisor'] },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { path: '/admin/units', label: 'Units (Short Term)', icon: Building2, page: 'units' },
      { path: '/admin/units-long-term', label: 'Units (Long Term)', icon: Building2, page: 'units_long_term' },
      { path: '/admin/projects', label: 'Destinations', icon: Building, page: 'projects' },
      { path: '/admin/acquisition', label: 'Owner leads', icon: Briefcase, page: 'acquisition' },
      { path: '/admin/owner-statement', label: 'Owner Statement', icon: FileBarChart2, page: 'owner_statement', roles: ['unit_acquisition_manager', 'owners_relations'] },
      { path: '/admin/owner/blocks', label: 'Owner blocks', icon: CalendarDays, page: 'owner_blocks', roles: ['owners_relations'] },
      { path: '/admin/users', label: 'Owners', icon: UserCircle, page: 'owners', roles: ['unit_acquisition_manager'] },
    ],
  },
  {
    id: 'bookings',
    label: 'Bookings',
    items: [
      { path: '/admin/reservations', label: 'Reservations', icon: CalendarDays, page: 'reservations', altPage: 'website_bookings', badge: 'website_pending', agentLabel: 'My Reservations', managerLabel: 'Team Reservations' },
      { path: '/admin/schedule', label: 'Schedule', icon: CalendarRange, page: 'schedule' },
      { path: '/admin/calendar-sync', label: 'Calendar Sync', icon: Link2, page: 'calendar_sync' },
      { path: '/admin/performance', label: 'Performance', icon: Trophy, page: 'performance' },
      { path: '/admin/reservation-audit', label: 'Reservation Audit', icon: ClipboardList, page: 'reservation_audit' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { path: '/admin/operations', label: 'Operations', icon: KeyRound, page: 'operations' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { path: '/admin/financial-system', label: 'Financial System', icon: Landmark, page: 'financial_system' },
      { path: '/admin/finance-audit', label: 'Audit', icon: ClipboardList, page: 'finance_audit' },
      { path: '/admin/promo-codes', label: 'Promo Codes', icon: Tag, page: 'promo_codes' },
    ],
  },
  {
    id: 'hr',
    label: 'HR',
    items: [
      { path: '/admin/users', label: 'User Management', icon: Users, page: 'users' },
      { path: '/admin/attendance', label: 'Attendance', icon: Clock, page: 'attendance' },
      { path: '/admin/requests', label: 'Requests', icon: Inbox, page: 'requests', badge: 'requests_pending', agentLabel: 'My requests' },
      { path: '/admin/holiday-access', label: 'Holidays access', icon: ShieldCheck, page: 'holiday_access' },
      { path: '/admin/tasks', label: 'Tasks', icon: ListTodo, page: 'tasks', roles: ['hr', 'hr_supervisor'] },
      { path: '/admin/deductions', label: 'Deductions/Bonus', icon: MinusCircle, page: 'deductions' },
      { path: '/admin/payslip', label: 'Payslip', icon: Receipt, page: 'payslip' },
      { path: '/admin/payroll', label: 'Payrolls', icon: Wallet, page: 'payroll' },
      { path: '/admin/job-offers', label: 'Job offers', icon: ClipboardList, page: 'job_offers', badge: 'job_pending' },
    ],
  },
];

function PendingCountBadge({ count, compact = false }) {
  if (!count || count < 1) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-white font-bold shadow-sm ${
        compact
          ? 'absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] px-0.5 text-[9px] leading-none'
          : 'min-w-[1.35rem] h-[1.35rem] px-1.5 text-[11px] leading-none ml-auto'
      }`}
      style={{ background: 'var(--pms-accent, #b5725a)' }}
      aria-label={`${count} pending website booking${count === 1 ? '' : 's'}`}
    >
      {label}
    </span>
  );
}

export default function Sidebar({ collapsed, isMobile, mobileOpen, onCloseMobile }) {
  const { user, logout } = useAuth();
  const { canAccess } = usePermissions();
  const navigate = useNavigate();
  const theme = getRoleTheme(user?.role);

  const showWebsitePending = canAccess('website_bookings');
  const showReviewPending = canSeeRequestQueue(user);
  const showJobPending = canAccess('job_offers');
  const acknowledgedLeave = useAcknowledgedRequestIds('leave', user?.id);
  const acknowledgedLoans = useAcknowledgedRequestIds('loan', user?.id);
  const acknowledgedWfh = useAcknowledgedRequestIds('wfh', user?.id);
  const { data: pendingBookings = [] } = useQuery({
    queryKey: ['website-bookings-pending'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'pending' } }).then((r) => r.data),
    enabled: showWebsitePending,
    refetchInterval: 30000,
  });
  const websiteNeedsReviewCount = Array.isArray(pendingBookings) ? pendingBookings.length : 0;
  const { data: pendingLeave = [] } = useQuery({
    queryKey: ['hr-leave-requests', user?.id, 'pending'],
    queryFn: () =>
      api.get('/hr/leave-requests', { params: { status: 'pending' } }).then((r) => r.data),
    enabled: showReviewPending && !!user?.id,
    refetchInterval: 30000,
  });
  const pendingLeaveCount = countActionableRequests(pendingLeave, {
    kind: 'leave',
    userId: user?.id,
    acknowledged: acknowledgedLeave,
  });
  const { data: pendingLoans = [] } = useQuery({
    queryKey: ['hr-loans', user?.id, 'pending'],
    queryFn: () => api.get('/hr/loans', { params: { status: 'pending' } }).then((r) => r.data),
    enabled: showReviewPending && !!user?.id,
    refetchInterval: 30000,
  });
  const { data: pendingWfh = [] } = useQuery({
    queryKey: ['hr-wfh', user?.id, 'pending'],
    queryFn: () => api.get('/hr/wfh', { params: { status: 'pending' } }).then((r) => r.data),
    enabled: showReviewPending && !!user?.id,
    refetchInterval: 30000,
  });
  const pendingLoanCount = countActionableRequests(pendingLoans, {
    kind: 'loan',
    userId: user?.id,
    acknowledged: acknowledgedLoans,
  });
  const pendingWfhCount = countActionableRequests(pendingWfh, {
    kind: 'wfh',
    userId: user?.id,
    acknowledged: acknowledgedWfh,
  });
  const pendingRequestsCount = pendingLeaveCount + pendingLoanCount + pendingWfhCount;
  const { data: jobSummary } = useQuery({
    queryKey: ['recruitment-summary'],
    queryFn: () => api.get('/recruitment/summary').then((r) => r.data),
    enabled: showJobPending,
    refetchInterval: 30000,
  });
  const pendingJobCount = jobSummary?.pendingApplications || 0;

  const handleLogout = () => {
    logout();
    navigate('/sign-in');
  };

  const showLabels = isMobile || !collapsed;
  const sidebarW = isMobile ? 288 : collapsed ? 64 : 256;

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        (canAccess(item.page) || (item.altPage && canAccess(item.altPage))) &&
        (!item.roles || item.roles.includes(user?.role)) &&
        (!item.excludeRoles || !item.excludeRoles.includes(user?.role))
    ),
  })).filter((section) => section.items.length);

  const handleNavClick = () => {
    if (isMobile) onCloseMobile();
  };

  return (
    <aside
      className="pms-sidebar fixed top-0 left-0 h-full flex flex-col z-40"
      style={{
        width: sidebarW,
        transform: isMobile && !mobileOpen ? 'translateX(-100%)' : 'translateX(0)',
        ...(isMobile && !mobileOpen ? { boxShadow: 'none', visibility: 'hidden' } : {}),
        transition: `transform 0.3s ease, width 0.3s ease, visibility 0s linear ${isMobile && !mobileOpen ? '0.3s' : '0s'}`,
      }}
    >
      <div className="pms-sidebar-rail" aria-hidden />

      <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/10 ${!showLabels ? 'justify-center' : ''}`}>
        <div
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
          style={{ background: 'var(--pms-accent)', boxShadow: '0 8px 24px var(--pms-nav-glow)' }}
        >
          <LogoMark className="h-6 w-auto text-ch-rose" strokeWidth={4.5} title="" />
        </div>
        {showLabels && (
          <div className="min-w-0">
            <div className="font-brand text-[1.05rem] uppercase leading-tight tracking-[0.16em] text-white">Cairo Homes</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/55 mt-0.5 truncate">
              {pmsLabel(user) || 'Property Management'}
            </div>
          </div>
        )}
      </div>

      {showLabels && (
        <div className="px-4 pt-4 pb-1">
          <p className="text-[10px] uppercase tracking-[0.28em] text-white/40">{theme.eyebrow}</p>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleSections.map((section, sectionIdx) => (
            <div key={section.id} className={sectionIdx === 0 ? '' : 'mt-1'}>
              {showLabels ? (
                <p className={`px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35 ${sectionIdx === 0 ? 'pt-1' : 'pt-3'}`}>
                  {section.label}
                </p>
              ) : sectionIdx > 0 ? (
                <div className="mx-2 my-2 h-px bg-white/10" />
              ) : null}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const label =
                    item.managerLabel && user?.role === 'reservations_manager'
                        ? item.managerLabel
                      : item.page === 'requests' && item.agentLabel && !showReviewPending
                        ? item.agentLabel
                      : item.agentLabel &&
                          (user?.role === 'reservations_web' ||
                            user?.role === 'reservations_manual' ||
                            user?.role === 'reservations')
                        ? item.agentLabel
                        : item.label;
                  const pendingCount =
                    item.badge === 'website_pending'
                      ? websiteNeedsReviewCount
                      : item.badge === 'requests_pending'
                        ? pendingRequestsCount
                      : item.badge === 'leave_pending'
                        ? pendingLeaveCount
                        : item.badge === 'loan_pending'
                          ? pendingLoanCount
                          : item.badge === 'wfh_pending'
                            ? pendingWfhCount
                            : item.badge === 'job_pending'
                              ? pendingJobCount
                              : 0;
                  const navTo =
                    item.badge === 'requests_pending' && pendingRequestsCount > 0
                      ? pendingLeaveCount > 0
                        ? `${item.path}?type=holiday&view=incoming`
                        : pendingWfhCount > 0
                          ? `${item.path}?type=wfh`
                          : `${item.path}?type=loans`
                      : item.badge === 'leave_pending' && pendingLeaveCount > 0
                        ? `${item.path}?view=incoming`
                        : item.path;
                  return (
                    <NavLink
                      key={item.path}
                      to={navTo}
                      end={Boolean(item.end)}
                      onClick={handleNavClick}
                      className={({ isActive }) =>
                        `sidebar-link ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'} ${!showLabels ? 'justify-center px-2' : ''}`
                      }
                      title={!showLabels ? (pendingCount ? `${label} (${pendingCount} pending)` : label) : undefined}
                    >
                      <span className="relative flex-shrink-0">
                        <item.icon className="w-5 h-5" strokeWidth={1.75} />
                        {!showLabels ? <PendingCountBadge count={pendingCount} compact /> : null}
                      </span>
                      {showLabels && <span className="truncate">{label}</span>}
                      {showLabels ? <PendingCountBadge count={pendingCount} /> : null}
                    </NavLink>
                  );
                })}
              </div>
            </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <NavLink
          to="/admin/profile"
          onClick={handleNavClick}
          className={({ isActive }) =>
            `sidebar-link mb-1 ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'} ${!showLabels ? 'justify-center px-2' : ''}`
          }
        >
          <UserCircle className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
          {showLabels && <span>Profile</span>}
        </NavLink>

        {showLabels && (
          <div className="flex items-center gap-3 px-3 py-2.5 mb-1 rounded-xl bg-white/5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ background: 'var(--pms-avatar)' }}
            >
              {user?.full_name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-white text-sm font-medium truncate">{user?.full_name}</div>
              <div className="text-white/50 text-xs truncate">
                {roleLabel(user)}
                {user?.staff_code ? ` · ${user.staff_code}` : ''}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          className={`sidebar-link sidebar-link-inactive w-full text-red-200/90 hover:text-red-50 hover:bg-red-500/20 ${!showLabels ? 'justify-center px-2' : ''}`}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
          {showLabels && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
