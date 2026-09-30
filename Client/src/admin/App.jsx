import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/layout/Layout';
import OwnerLayout from './components/layout/OwnerLayout';
import LoadingSpinner from './components/ui/LoadingSpinner';
import { canAccess, isOwnerRole } from './utils/permissions';
import { defaultAdminPage, ADMIN_LOGIN, ADMIN_CHANGE_PASSWORD } from './utils/adminRoutes';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Units = lazy(() => import('./pages/Units'));
const UnitsLongTerm = lazy(() => import('./pages/UnitsLongTerm'));
const Reservations = lazy(() => import('./pages/Reservations'));
const FinancialSystem = lazy(() => import('./pages/FinancialSystem'));
const Users = lazy(() => import('./pages/Users'));
const Payrolls = lazy(() => import('./pages/Payrolls'));
const Deductions = lazy(() => import('./pages/Deductions'));
const Requests = lazy(() => import('./pages/Requests'));
const HolidayAccess = lazy(() => import('./pages/HolidayAccess'));
const JobOffers = lazy(() => import('./pages/JobOffers'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Payslip = lazy(() => import('./pages/Payslip'));
const Profile = lazy(() => import('./pages/Profile'));
const CalendarSync = lazy(() => import('./pages/CalendarSync'));
const OtaInbox = lazy(() => import('./pages/OtaInbox'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Housekeeping = lazy(() => import('./pages/Housekeeping'));
const Operations = lazy(() => import('./pages/Operations'));
const Projects = lazy(() => import('./pages/Projects'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const OwnerDashboard = lazy(() => import('./pages/OwnerDashboard'));
const OwnerReservations = lazy(() => import('./pages/OwnerReservations'));
const OwnerStatement = lazy(() => import('./pages/OwnerStatement'));
const OwnerPayoutsPage = lazy(() =>
  import('./pages/OwnerPortalPages').then((m) => ({ default: m.OwnerPayoutsPage }))
);
const AcquisitionPipeline = lazy(() => import('./pages/AcquisitionPipeline'));
const FinanceAudit = lazy(() => import('./pages/FinanceAudit'));
const ReservationAudit = lazy(() => import('./pages/ReservationAudit'));
const OwnerDateBlocks = lazy(() => import('./pages/OwnerDateBlocks'));
const PromoCodes = lazy(() => import('./pages/PromoCodes'));
const Performance = lazy(() => import('./pages/Performance'));
const Tasks = lazy(() => import('./pages/Tasks'));

function PageFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );
}

function ProtectedRoute({ children, page, allowFirstLogin }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!user) return <Navigate to={ADMIN_LOGIN} replace />;

  if (user.is_first_login && !allowFirstLogin && page !== 'change-password') {
    return <Navigate to={ADMIN_CHANGE_PASSWORD} replace />;
  }

  const pages = Array.isArray(page) ? page : page ? [page] : [];
  if (pages.length && !pages.some((p) => canAccess(user, p))) {
    return <Navigate to={defaultAdminPage(user)} replace />;
  }

  const body = <Suspense fallback={<PageFallback />}>{children}</Suspense>;
  if (allowFirstLogin) return body;
  if (isOwnerRole(user)) return <OwnerLayout>{body}</OwnerLayout>;
  return <Layout>{body}</Layout>;
}

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!user) return <Navigate to={ADMIN_LOGIN} replace />;
  if (user.is_first_login) return <Navigate to={ADMIN_CHANGE_PASSWORD} replace />;
  return <Navigate to={defaultAdminPage(user)} replace />;
}


function LegacyFinanceRedirect({ tab }) {
  const location = useLocation();
  const qs = location.search || (tab ? `?tab=${tab}` : '');
  const suffix = qs.includes('tab=') ? qs : tab ? `?tab=${tab}${location.search ? `&${location.search.slice(1)}` : ''}` : location.search;
  return <Navigate to={`/admin/financial-system${suffix}`} replace />;
}

function LegacyOpsRedirect({ tab }) {
  const location = useLocation();
  const suffix = tab ? `?tab=${tab}${location.search ? `&${location.search.slice(1)}` : ''}` : location.search;
  return <Navigate to={`/admin/operations${suffix}`} replace />;
}

function LegacyHousekeepingRedirect({ tab }) {
  const location = useLocation();
  const opsTab =
    tab === 'today' ? 'cleans' : tab === 'history' ? 'cleans-history' : tab || 'cleans';
  const suffix = `?tab=${opsTab}${location.search ? `&${location.search.slice(1)}` : ''}`;
  return <Navigate to={`/admin/operations${suffix}`} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="login" element={<Navigate to={ADMIN_LOGIN} replace />} />
      <Route
        path="change-password"
        element={
          <ProtectedRoute page="change-password" allowFirstLogin>
            <ChangePassword />
          </ProtectedRoute>
        }
      />
      <Route path="dashboard" element={<ProtectedRoute page="dashboard"><Dashboard /></ProtectedRoute>} />
      <Route path="units" element={<ProtectedRoute page="units"><Units /></ProtectedRoute>} />
      <Route path="units-long-term" element={<ProtectedRoute page="units_long_term"><UnitsLongTerm /></ProtectedRoute>} />
      <Route path="units-for-sale" element={<Navigate to="/admin/units-long-term" replace />} />
      <Route path="projects" element={<ProtectedRoute page="projects"><Projects /></ProtectedRoute>} />
      <Route path="reservations" element={<ProtectedRoute page={['reservations', 'website_bookings']}><Reservations /></ProtectedRoute>} />
      <Route path="website-bookings" element={<Navigate to="/admin/reservations?tab=requests" replace />} />
      <Route path="website-bookings/unassigned" element={<Navigate to="/admin/reservations?tab=requests" replace />} />
      <Route path="website-bookings/history" element={<Navigate to="/admin/reservations?tab=history" replace />} />
      <Route path="schedule" element={<ProtectedRoute page="schedule"><Schedule /></ProtectedRoute>} />
      <Route path="calendar-sync" element={<ProtectedRoute page="calendar_sync"><CalendarSync /></ProtectedRoute>} />
      <Route path="ota-inbox" element={<ProtectedRoute page="calendar_sync"><OtaInbox /></ProtectedRoute>} />
      <Route path="performance" element={<ProtectedRoute page="performance"><Performance /></ProtectedRoute>} />
      <Route path="tasks" element={<ProtectedRoute page="tasks"><Tasks /></ProtectedRoute>} />

      
      <Route path="financial-system" element={<ProtectedRoute page="financial_system"><FinancialSystem /></ProtectedRoute>} />
      <Route path="finance" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="profit" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="expenses" element={<LegacyFinanceRedirect tab="manual" />} />
      <Route path="petty-cash" element={<LegacyFinanceRedirect tab="petty-cash" />} />
      <Route path="owner-settlements" element={<LegacyFinanceRedirect tab="owners" />} />
      <Route path="owner-statement" element={<ProtectedRoute page="owner_statement"><OwnerStatement /></ProtectedRoute>} />
      <Route path="utilities" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="marketing" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="salaries" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="invoices" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="payouts" element={<LegacyFinanceRedirect tab="owners" />} />
      <Route path="billing" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="transactions" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="treasury" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="cashflow" element={<LegacyFinanceRedirect tab="ledger" />} />

      <Route path="operations" element={<ProtectedRoute page="operations"><Operations /></ProtectedRoute>} />
      <Route path="housekeeping" element={<ProtectedRoute page="housekeeping"><Housekeeping /></ProtectedRoute>} />

      
      <Route path="housekeeping/today" element={<LegacyHousekeepingRedirect tab="today" />} />
      <Route path="housekeeping/history" element={<LegacyHousekeepingRedirect tab="history" />} />
      <Route path="ops/checkins-today" element={<LegacyOpsRedirect tab="today" />} />
      <Route path="ops/checkins-history" element={<LegacyOpsRedirect tab="history" />} />
      <Route path="ops/checkin-comments" element={<LegacyOpsRedirect tab="comments" />} />
      <Route path="users" element={<ProtectedRoute page={['users', 'owners']}><Users /></ProtectedRoute>} />
      <Route path="payroll" element={<ProtectedRoute page="payroll"><Payrolls /></ProtectedRoute>} />
      <Route path="deductions" element={<ProtectedRoute page="deductions"><Deductions /></ProtectedRoute>} />
      <Route path="requests" element={<ProtectedRoute page="requests"><Requests /></ProtectedRoute>} />
      <Route path="holiday-requests" element={<Navigate to="/admin/requests?type=holiday" replace />} />
      <Route path="holiday-access" element={<ProtectedRoute page="holiday_access"><HolidayAccess /></ProtectedRoute>} />
      <Route path="job-offers" element={<ProtectedRoute page="job_offers"><JobOffers /></ProtectedRoute>} />
      <Route path="attendance" element={<ProtectedRoute page="attendance"><Attendance /></ProtectedRoute>} />
      <Route path="loans" element={<Navigate to="/admin/requests?type=loans" replace />} />
      <Route path="wfh" element={<Navigate to="/admin/requests?type=wfh" replace />} />
      <Route path="payslip" element={<ProtectedRoute page="payslip"><Payslip /></ProtectedRoute>} />
      <Route path="promo-codes" element={<ProtectedRoute page="promo_codes"><PromoCodes /></ProtectedRoute>} />
      <Route path="acquisition" element={<ProtectedRoute page="acquisition"><AcquisitionPipeline /></ProtectedRoute>} />
      <Route path="finance-audit" element={<ProtectedRoute page="finance_audit"><FinanceAudit /></ProtectedRoute>} />
      <Route path="reservation-audit" element={<ProtectedRoute page="reservation_audit"><ReservationAudit /></ProtectedRoute>} />
      <Route path="owner" element={<ProtectedRoute page="owner"><OwnerDashboard /></ProtectedRoute>} />
      <Route path="owner/reservations" element={<ProtectedRoute page="owner_reservations"><OwnerReservations /></ProtectedRoute>} />
      <Route path="owner/statement" element={<ProtectedRoute page="owner_statement"><OwnerStatement /></ProtectedRoute>} />
      <Route path="owner/payouts" element={<ProtectedRoute page="owner_payouts"><OwnerPayoutsPage /></ProtectedRoute>} />
      <Route path="owner/blocks" element={<ProtectedRoute page="owner_blocks"><OwnerDateBlocks /></ProtectedRoute>} />
      <Route path="profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route index element={<RoleRedirect />} />
      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  );
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
