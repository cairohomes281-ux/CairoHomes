import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bell, Search, X } from 'lucide-react';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { formatDateTime } from '../../utils/formatters';
import { roleLabel, pmsLabel } from '../../utils/permissions';
import { getRoleTheme } from '../../utils/roleTheme';

const NOTIFICATION_ICONS = {
  new_booking: '🏠',
  booking_accepted: '✅',
  booking_rejected: '❌',
  reservation_created: '📝',
  cancel_request: '⚠️',
  payment_pending: '💳',
  checkin_reminder: '📅',
  checkin: '📅',
  payment: '💳',
  default: '🔔',
};

function notificationHref(n) {
  if (n.type === 'booking_accepted' || n.type === 'booking_rejected') {
    return '/admin/reservations?tab=history';
  }
  if (n.type === 'new_booking' || n.entity_type === 'booking') {
    return '/admin/reservations?tab=requests';
  }
  if (n.entity_type === 'reservation' && n.entity_id) {
    return `/admin/reservations?view=${n.entity_id}`;
  }
  return '/admin/reservations';
}

export default function Header({ onToggleSidebar, sidebarWidth = 256 }) {
  const { user } = useAuth();
  const theme = getRoleTheme(user?.role);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showNotifs, setShowNotifs] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const notifsRef = useRef(null);

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications?limit=15').then((r) => r.data),
    refetchInterval: 30000,
    enabled: !!user?.id,
  });

  const markRead = useMutation({
    mutationFn: (id) =>
      id === 'all' ? api.put('/notifications/read-all') : api.put(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    const handler = (e) => {
      if (notifsRef.current && !notifsRef.current.contains(e.target)) setShowNotifs(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;
    const base = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(base, {
      auth: { token: localStorage.getItem('pms_token') || '' },
      transports: ['websocket', 'polling'],
    });
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['website-bookings-pending'] });
      qc.invalidateQueries({ queryKey: ['website-bookings-history'] });
    };
    socket.on('pms:notification', refresh);
    socket.on('sales:notification', refresh);
    return () => {
      socket.off('pms:notification', refresh);
      socket.off('sales:notification', refresh);
      socket.disconnect();
    };
  }, [user?.id, user?.role, qc]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (search.trim()) navigate(`/admin/reservations?search=${encodeURIComponent(search.trim())}`);
  };

  const openNotification = (n) => {
    markRead.mutate(n.id);
    setShowNotifs(false);
    navigate(notificationHref(n));
  };

  const unread = notifData?.unreadCount || 0;
  const notifications = notifData?.notifications || [];

  return (
    <header
      className="pms-header fixed top-0 right-0 left-0 z-30 h-16 flex items-center justify-between px-4"
      style={{ marginLeft: sidebarWidth }}
    >
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: 'var(--pms-accent)' }} />

      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-2 rounded-xl text-ch-muted hover:bg-black/[0.04] transition-colors flex-shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        {sidebarWidth === 0 && (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ch-pine tracking-tight truncate">Cairo Homes</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ch-muted truncate">
              {pmsLabel(user)}
            </div>
          </div>
        )}

        {sidebarWidth > 0 && (
          <div className="hidden lg:flex items-center gap-2 pl-1">
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ background: 'var(--pms-accent-soft)', color: 'var(--pms-accent-text)' }}
            >
              {theme.eyebrow}
            </span>
          </div>
        )}

        <form onSubmit={handleSearch} className="hidden sm:flex items-center ml-1">
          {showSearch ? (
            <div className="flex items-center gap-2 rounded-xl border border-ch-line bg-white/80 px-3 py-1.5 shadow-sm">
              <Search className="w-4 h-4 text-ch-muted" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search reservations..."
                className="w-48 bg-transparent text-sm outline-none placeholder:text-ch-muted/60 text-ch-pine"
              />
              <button type="button" onClick={() => { setShowSearch(false); setSearch(''); }}>
                <X className="w-4 h-4 text-ch-muted hover:text-ch-pine" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="p-2 rounded-xl text-ch-muted hover:bg-black/[0.04] transition-colors flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              <span className="text-sm text-ch-muted/70 hidden md:block">Search...</span>
            </button>
          )}
        </form>
      </div>

      <div className="flex items-center gap-2" ref={notifsRef}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifs((v) => !v)}
            className="p-2 rounded-xl text-ch-muted hover:bg-black/[0.04] transition-colors relative"
          >
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-5 h-5 text-white text-xs rounded-full flex items-center justify-center font-bold shadow"
                style={{ background: 'var(--pms-accent)' }}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-24px)] bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-ch-line overflow-hidden animate-slide-in">
              <div className="flex items-center justify-between px-4 py-3 border-b border-ch-line bg-[var(--pms-header-tint)]">
                <span className="font-semibold text-ch-pine text-sm">Notifications</span>
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => markRead.mutate('all')}
                    className="text-xs font-medium hover:opacity-80"
                    style={{ color: 'var(--pms-accent-text)' }}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-ch-muted text-sm">No notifications</div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => openNotification(n)}
                      className={`px-4 py-3 border-b border-ch-line/60 cursor-pointer hover:bg-[var(--pms-accent-soft)] transition-colors ${
                        !n.is_read ? 'bg-[var(--pms-header-tint)]' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-lg leading-none mt-0.5">
                          {NOTIFICATION_ICONS[n.type] || NOTIFICATION_ICONS.default}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-ch-pine">{n.title}</div>
                          <div className="text-xs text-ch-muted mt-0.5 line-clamp-2">{n.message}</div>
                          <div className="text-xs text-ch-muted/70 mt-1">{formatDateTime(n.created_at)}</div>
                        </div>
                        {!n.is_read && (
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                            style={{ background: 'var(--pms-accent)' }}
                          />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 pl-3 border-l border-ch-line">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
            style={{ background: 'var(--pms-avatar)' }}
          >
            {user?.full_name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="hidden md:block min-w-0">
            <div className="text-sm font-medium text-ch-pine leading-tight truncate max-w-[140px]">
              {user?.full_name}
            </div>
            <div className="text-[11px] text-ch-muted leading-tight">
              {roleLabel(user)}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
