import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/http';

function SalesShell() {
  const { salesUser, salesLogout } = useAuth();
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    if (!salesUser) return undefined;
    api.get('/sales/notifications').then((r) => setNotes(r.data.items || [])).catch(() => {});
    const base = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(base, {
      auth: { token: localStorage.getItem('ch_sales_token') || '' },
    });
    socket.on('sales:notification', (payload) => {
      setNotes((prev) => [{ id: Date.now(), ...payload, created_at: new Date().toISOString() }, ...prev]);
    });
    return () => socket.disconnect();
  }, [salesUser]);

  if (!salesUser || !['sales', 'admin'].includes(salesUser.role)) {
    return <Navigate to="/sales/login" replace />;
  }

  return (
    <div className="sales-shell min-h-screen bg-ch-ivory">
      <header className="bg-ch-pine-dark text-white px-5 h-14 flex items-center justify-between">
        <div className="flex gap-6 text-sm font-medium">
          <Link to="/sales">Dashboard</Link>
          <Link to="/sales/bookings">Bookings</Link>
          <Link to="/sales/schedule">Schedule</Link>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-white/70">{notes.filter((n) => !n.is_read).length} new</span>
          <button type="button" onClick={salesLogout}>Sign out</button>
        </div>
      </header>
      <div className="mx-auto max-w-ch px-5 py-8">
        <Outlet context={{ notes }} />
      </div>
    </div>
  );
}

function SalesLogin() {
  const { salesLogin, salesUser } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (salesUser) return <Navigate to="/sales" replace />;

  return (
    <main className="min-h-screen grid place-items-center bg-ch-ivory px-5">
      <form
        className="w-full max-w-sm bg-white border border-ch-line rounded-2xl p-6 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await salesLogin(username, password);
            navigate('/sales');
          } catch (err) {
            setError(err.response?.data?.error || err.message);
          }
        }}
      >
        <h1 className="font-display text-2xl text-ch-pine">Sales portal</h1>
        <input className="w-full border rounded-xl px-3 py-2" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" className="w-full border rounded-xl px-3 py-2" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full btn-pill bg-ch-pine text-white py-2 font-semibold">Sign in</button>
      </form>
    </main>
  );
}

function SalesDashboard() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get('/sales/dashboard').then((r) => setStats(r.data)).catch(() => {});
  }, []);
  return (
    <div>
      <h1 className="font-display text-3xl text-ch-pine">Sales dashboard</h1>
      <div className="mt-6 grid sm:grid-cols-3 gap-4">
        <Stat label="Pending / held" value={stats?.pending} />
        <Stat label="Upcoming confirmed" value={stats?.upcomingConfirmed} />
        <Stat label="Recent" value={stats?.recent?.length} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white rounded-2xl border border-ch-line p-5">
      <div className="text-sm text-ch-muted">{label}</div>
      <div className="font-num text-3xl font-semibold mt-2 tracking-tight">{value ?? '—'}</div>
    </div>
  );
}

function SalesBookings() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get('/sales/bookings').then((r) => setItems(r.data.items || [])).catch(() => {});
  }, []);
  return (
    <div>
      <h1 className="font-display text-3xl text-ch-pine">Bookings</h1>
      <div className="mt-6 space-y-2">
        {items.map((b) => (
          <div key={b.id} className="bg-white border border-ch-line rounded-xl p-4 flex justify-between gap-4">
            <div>
              <div className="font-medium">{b.listing_title}</div>
              <div className="text-sm text-ch-muted">{b.guest_name} · {b.checkin} → {b.checkout}</div>
            </div>
            <select
              className="border rounded-lg px-2 text-sm h-9"
              value={b.status}
              onChange={async (e) => {
                const { data } = await api.patch(`/sales/bookings/${b.id}/status`, { status: e.target.value });
                setItems((prev) => prev.map((x) => (x.id === b.id ? data : x)));
              }}
            >
              {['held', 'pending', 'confirmed', 'cancelled'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalesSchedule() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get('/sales/schedule').then((r) => setItems(r.data.items || [])).catch(() => {});
  }, []);
  return (
    <div>
      <h1 className="font-display text-3xl text-ch-pine">Schedule</h1>
      <div className="mt-6 space-y-2">
        {items.map((b) => (
          <div key={b.id} className="bg-white border border-ch-line rounded-xl p-4">
            <div className="font-medium">{b.listing_title}</div>
            <div className="text-sm text-ch-muted">{b.checkin} → {b.checkout} · {b.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SalesRoutes() {
  return (
    <Routes>
      <Route path="login" element={<SalesLogin />} />
      <Route element={<SalesShell />}>
        <Route index element={<SalesDashboard />} />
        <Route path="bookings" element={<SalesBookings />} />
        <Route path="schedule" element={<SalesSchedule />} />
      </Route>
    </Routes>
  );
}
