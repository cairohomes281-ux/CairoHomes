import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Building, LogOut, LayoutDashboard, CalendarDays, FileBarChart2, Wallet } from 'lucide-react';

const NAV = [
  { to: '/admin/owner', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/owner/reservations', label: 'Reservations', icon: CalendarDays },
  { to: '/admin/owner/blocks', label: 'Block dates', icon: CalendarDays },
  { to: '/admin/owner/statement', label: 'Statement', icon: FileBarChart2 },
  { to: '/admin/owner/payouts', label: 'Payouts', icon: Wallet },
];

export default function OwnerLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/sign-in');
  };

  return (
    <div className="pms-shell min-h-screen bg-gray-50">
      <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-gradient-to-r from-primary-900 to-primary-800 flex items-center justify-between px-4 sm:px-6 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
            <Building className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-base leading-tight">Cairo Homes</div>
            <div className="text-blue-200 text-xs">Owner Portal</div>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
                  isActive ? 'bg-white/20 text-white' : 'text-blue-100 hover:bg-white/10'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <div className="hidden sm:block text-right">
            <div className="text-white text-sm font-medium leading-tight">{user?.full_name}</div>
            <div className="text-blue-200 text-xs">Owner</div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-red-300 hover:text-white hover:bg-red-500/30 rounded-lg px-3 py-2 text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      <main className="pt-16 min-h-screen">
        <div className="md:hidden flex gap-2 px-4 pt-3 overflow-x-auto">
          {NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium ${
                  isActive ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 border'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
        <div className="max-w-5xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
