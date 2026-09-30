import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Copy,
  Link2,
  Plug,
  RefreshCw,
  Unplug,
  MessageSquare,
  DollarSign,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import Modal from '../components/ui/Modal';
import { currency } from '../utils/formatters';

const PLATFORMS = [
  { id: 'airbnb', label: 'Airbnb' },
  { id: 'booking', label: 'Booking.com' },
];

const API_PROVIDERS = [
  { key: 'booking_api', label: 'Booking.com (API)' },
  { key: 'airbnb_api', label: 'Airbnb (API)' },
];

const STATUS_STYLES = {
  connected: 'bg-emerald-100 text-emerald-800',
  syncing: 'bg-sky-100 text-sky-800',
  failed: 'bg-rose-100 text-rose-800',
  disconnected: 'bg-stone-100 text-stone-600',
};

function unitCode(unit) {
  return unit.unit_number || unit.slug || unit.title || '—';
}

function feedFor(unit, platformId) {
  return (unit.feeds || []).find((f) => f.platform === platformId && f.ical_url) || null;
}

function formatWhen(value) {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function StatusBadge({ status }) {
  const key = STATUS_STYLES[status] ? status : 'disconnected';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[key]}`}>
      {key}
    </span>
  );
}

function UnitDetailsModal({ unit, open, onClose, focusPlatform }) {
  const qc = useQueryClient();
  const [urls, setUrls] = useState({});
  const [listings, setListings] = useState({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextUrls = {};
    const nextListings = {};
    for (const p of PLATFORMS) {
      const feed = feedFor(unit, p.id);
      nextUrls[p.id] = feed?.ical_url || '';
      nextListings[p.id] = feed?.external_listing_id || '';
    }
    setUrls(nextUrls);
    setListings(nextListings);
    setCopied(false);
  }, [open, unit]);

  async function copySiteLink() {
    if (!unit.export_url) {
      toast.error('Publish this unit to generate a calendar link');
      return;
    }
    try {
      await navigator.clipboard.writeText(unit.export_url);
      setCopied(true);
      toast.success('Cairo Homes export calendar copied — paste into the channel’s import calendar');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  }

  async function saveAll() {
    setSaving(true);
    try {
      for (const p of PLATFORMS) {
        const next = (urls[p.id] || '').trim();
        const listing = (listings[p.id] || '').trim();
        const current = feedFor(unit, p.id);
        const currentUrl = current?.ical_url || '';
        const currentListing = current?.external_listing_id || '';
        if (next === currentUrl && listing === currentListing) continue;
        if (!next) {
          if (currentUrl) await api.delete(`/ota-calendar/${unit.id}/${p.id}`);
          continue;
        }
        await api.put(`/ota-calendar/${unit.id}/${p.id}`, {
          ical_url: next,
          external_listing_id: listing || null,
          enabled: true,
        });
      }
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      qc.invalidateQueries({ queryKey: ['ota-calendar'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      toast.success('Channel mapping saved');
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save channel');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={unitCode(unit)}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={saveAll}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {unit.title ? <p className="text-sm text-ch-muted">{unit.title}</p> : null}

        <div className="rounded-2xl border border-dashed border-ch-line bg-[#f7f9fc] p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-ch-pine">
            <Link2 className="w-4 h-4" />
            Cairo Homes export calendar (PMS → Channel)
          </div>
          <p className="text-xs text-ch-muted">
            Paste this into the channel’s “import calendar” so their inventory blocks when Cairo Homes has a
            booking or schedule hold. iCal does not push rates or restrictions.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="input font-mono text-xs flex-1"
              readOnly
              value={unit.export_url || 'Publish this unit to generate a link'}
            />
            <button
              type="button"
              className="btn-primary shrink-0"
              disabled={!unit.export_url}
              onClick={copySiteLink}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-sm font-semibold text-ch-pine">Import calendars (Channel → PMS)</p>
          <p className="text-xs text-ch-muted -mt-2">
            Map each external listing explicitly — names often differ. Connection type for these
            channels is iCal (availability only).
          </p>
          {PLATFORMS.map((p) => {
            const feed = feedFor(unit, p.id);
            return (
              <div key={p.id} className="rounded-xl border border-ch-line p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="label mb-0">{p.label}</label>
                  <StatusBadge status={feed?.status || (urls[p.id] ? 'disconnected' : 'disconnected')} />
                </div>
                <input
                  className="input font-mono text-xs"
                  value={urls[p.id] || ''}
                  onChange={(e) => setUrls((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder={`${p.label} iCal export URL (https://…)`}
                  disabled={saving}
                  autoFocus={focusPlatform === p.id}
                />
                <input
                  className="input text-xs"
                  value={listings[p.id] || ''}
                  onChange={(e) => setListings((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder="External listing / room ID (optional mapping label)"
                  disabled={saving}
                />
                {feed?.last_sync_at || feed?.last_sync_error ? (
                  <p className="text-[11px] text-ch-muted">
                    Last sync: {formatWhen(feed.last_sync_at)}
                    {feed.last_sync_error ? (
                      <span className="text-rose-600"> — {feed.last_sync_error}</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function ApiConnectionModal({ open, onClose, connection, units, providerKey: initialProvider }) {
  const qc = useQueryClient();
  const isEdit = Boolean(connection?.id);
  const [providerKey, setProviderKey] = useState(initialProvider || 'booking_api');
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hotelId, setHotelId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [mapUnitId, setMapUnitId] = useState('');
  const [mapListingId, setMapListingId] = useState('');
  const [mapRoomType, setMapRoomType] = useState('');
  const [mapRatePlan, setMapRatePlan] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProviderKey(connection?.provider_key || initialProvider || 'booking_api');
    setDisplayName(connection?.display_name || '');
    setBaseUrl('');
    setApiKey('');
    setClientId('');
    setClientSecret('');
    setHotelId('');
    setEnabled(connection?.enabled !== false);
    setMapUnitId('');
    setMapListingId('');
    setMapRoomType('');
    setMapRatePlan('');
  }, [open, connection, initialProvider]);

  async function saveConnection() {
    setSaving(true);
    try {
      const credentials = {};
      if (baseUrl.trim()) credentials.base_url = baseUrl.trim();
      if (apiKey.trim()) credentials.api_key = apiKey.trim();
      if (clientId.trim()) credentials.client_id = clientId.trim();
      if (clientSecret.trim()) credentials.client_secret = clientSecret.trim();
      if (hotelId.trim()) credentials.hotel_id = hotelId.trim();

      if (isEdit) {
        await api.patch(`/channel-manager/connections/api/${connection.id}`, {
          display_name: displayName || undefined,
          credentials: Object.keys(credentials).length ? credentials : undefined,
          enabled,
          sync_enabled: enabled,
        });
        toast.success('Connection updated');
      } else {
        if (!credentials.base_url || !(credentials.api_key || credentials.client_id)) {
          toast.error('Base URL and API key (or client id) are required');
          setSaving(false);
          return;
        }
        await api.post('/channel-manager/connections/api', {
          provider_key: providerKey,
          display_name: displayName || undefined,
          credentials,
          enabled,
          sync_enabled: enabled,
        });
        toast.success('API connection created');
      }
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save connection');
    } finally {
      setSaving(false);
    }
  }

  async function saveMapping() {
    if (!connection?.id) {
      toast.error('Save the connection first, then add mappings');
      return;
    }
    if (!mapUnitId || !mapListingId.trim()) {
      toast.error('Unit and external listing ID are required');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/channel-manager/connections/api/${connection.id}/mappings`, {
        unit_id: mapUnitId,
        external_listing_id: mapListingId.trim(),
        external_room_type_id: mapRoomType.trim() || null,
        external_rate_plan_id: mapRatePlan.trim() || null,
      });
      toast.success('Unit mapping saved');
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      setMapUnitId('');
      setMapListingId('');
      setMapRoomType('');
      setMapRatePlan('');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save mapping');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${connection?.display_name || 'API connection'}` : 'Add API connection'}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={saveConnection}>
            {saving ? 'Saving…' : isEdit ? 'Update credentials' : 'Create connection'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-ch-muted">
          Enter Connectivity credentials from Booking.com or Airbnb. Paths can be customized later via
          credential keys (availability_path, rates_path, reservations_path, messages_path).
        </p>
        {!isEdit ? (
          <div>
            <label className="label">Provider</label>
            <select
              className="input"
              value={providerKey}
              onChange={(e) => setProviderKey(e.target.value)}
            >
              {API_PROVIDERS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label className="label">Display name</label>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Booking.com production"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Base URL</label>
            <input
              className="input font-mono text-xs"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={isEdit ? 'Leave blank to keep existing' : 'https://…'}
            />
          </div>
          <div>
            <label className="label">API key / access token</label>
            <input
              className="input font-mono text-xs"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? 'Leave blank to keep' : ''}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">Hotel / account ID</label>
            <input
              className="input font-mono text-xs"
              value={hotelId}
              onChange={(e) => setHotelId(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="label">Client ID</label>
            <input
              className="input font-mono text-xs"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="OAuth (optional)"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">Client secret</label>
            <input
              className="input font-mono text-xs"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="OAuth (optional)"
              autoComplete="off"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-ch-pine">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled for sync
        </label>

        {isEdit ? (
          <div className="rounded-xl border border-ch-line p-3 space-y-3">
            <p className="text-sm font-semibold text-ch-pine">Unit ↔ listing mapping</p>
            <p className="text-xs text-ch-muted">
              Map Cairo Homes units to external listing / room / rate-plan IDs for ARI and reservation import.
            </p>
            {(connection.mappings || []).length > 0 ? (
              <ul className="space-y-1 text-xs text-ch-muted">
                {connection.mappings.map((m) => {
                  const u = (units || []).find((x) => x.id === m.unit_id);
                  return (
                    <li key={m.id} className="flex justify-between gap-2">
                      <span>
                        {u ? unitCode(u) : m.unit_id} → {m.external_listing_id}
                        {m.external_rate_plan_id ? ` · rate ${m.external_rate_plan_id}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-ch-muted">No mappings yet.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className="input text-xs"
                value={mapUnitId}
                onChange={(e) => setMapUnitId(e.target.value)}
              >
                <option value="">Select unit…</option>
                {(units || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {unitCode(u)}
                  </option>
                ))}
              </select>
              <input
                className="input text-xs"
                value={mapListingId}
                onChange={(e) => setMapListingId(e.target.value)}
                placeholder="External listing ID"
              />
              <input
                className="input text-xs"
                value={mapRoomType}
                onChange={(e) => setMapRoomType(e.target.value)}
                placeholder="Room type ID (optional)"
              />
              <input
                className="input text-xs"
                value={mapRatePlan}
                onChange={(e) => setMapRatePlan(e.target.value)}
                placeholder="Rate plan ID (optional)"
              />
            </div>
            <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={saveMapping}>
              Add / update mapping
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default function CalendarSync() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [focusPlatform, setFocusPlatform] = useState(null);
  const [tab, setTab] = useState('units');
  const [apiModal, setApiModal] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['channel-manager'],
    queryFn: () => api.get('/channel-manager/overview').then((r) => r.data),
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['channel-manager-logs'],
    queryFn: () => api.get('/channel-manager/sync-logs?limit=40').then((r) => r.data),
    enabled: tab === 'logs',
  });

  const units = data?.units || [];
  const providers = data?.providers || [];
  const apiConnections = data?.connections?.api || [];
  const revenueChannels = data?.revenue?.channels || [];

  const refreshAllMutation = useMutation({
    mutationFn: () => api.post('/channel-manager/sync', {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      qc.invalidateQueries({ queryKey: ['channel-manager-logs'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      const errCount = (res.data?.errors || 0) + (res.data?.api_errors || 0);
      if (errCount > 0) {
        toast.error(`Sync finished with ${errCount} error${errCount === 1 ? '' : 's'}`);
      } else {
        toast.success('Channel sync complete');
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Sync failed'),
  });

  const syncFeedMutation = useMutation({
    mutationFn: (feedId) => api.post('/channel-manager/sync', { feed_id: feedId }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      qc.invalidateQueries({ queryKey: ['channel-manager-logs'] });
      if (res.data?.ok === false) toast.error(res.data.error || 'Sync failed');
      else toast.success('Feed synced');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Sync failed'),
  });

  const syncApiMutation = useMutation({
    mutationFn: (connectionId) => api.post('/channel-manager/sync', { connection_id: connectionId }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      qc.invalidateQueries({ queryKey: ['channel-manager-logs'] });
      if (res.data?.ok === false) toast.error(res.data.error || 'API sync failed');
      else toast.success('API connection synced');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'API sync failed'),
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (Array.isArray(units) ? units : []).filter((u) => {
        if (!q) return true;
        return [u.title, u.unit_number, u.slug].filter(Boolean).join(' ').toLowerCase().includes(q);
      }),
    [units, q]
  );

  function openUnit(unit, platformId = null) {
    setFocusPlatform(platformId);
    setSelected(unit);
  }

  const liveSelected =
    selected && (Array.isArray(units) ? units : []).find((u) => u.id === selected.id);

  const failedFeeds = useMemo(
    () =>
      (Array.isArray(units) ? units : []).flatMap((u) =>
        (u.feeds || [])
          .filter((f) => f.status === 'failed' || f.last_sync_error)
          .map((f) => ({ ...f, unit: u }))
      ),
    [units]
  );

  const liveApiConnection =
    apiModal?.connectionId &&
    apiConnections.find((c) => c.id === apiModal.connectionId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Channel Manager</h1>
          <p className="page-subtitle">
            Central sync for OTAs. Configure API credentials for full ARI and reservations; iCal remains
            an availability-only fallback.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/ota-inbox" className="btn-secondary">
            <MessageSquare className="w-4 h-4" />
            OTA Inbox
          </Link>
          <button
            type="button"
            className="btn-secondary"
            disabled={refreshAllMutation.isPending}
            onClick={() => refreshAllMutation.mutate()}
          >
            <RefreshCw className={`w-4 h-4 ${refreshAllMutation.isPending ? 'animate-spin' : ''}`} />
            Sync now
          </button>
        </div>
      </div>

      {revenueChannels.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {revenueChannels.map((ch) => (
            <div key={ch.channel} className="rounded-2xl border border-ch-line bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ch-muted">
                <DollarSign className="w-3.5 h-3.5" />
                {ch.channel}
              </div>
              <p className="mt-1 text-lg font-semibold text-ch-pine">{currency(ch.gross)}</p>
              <p className="text-xs text-ch-muted">
                {ch.count} stays · commission {currency(ch.commission)} · net {currency(ch.net)}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'units', label: 'Unit mapping' },
          { id: 'providers', label: 'API connections' },
          { id: 'logs', label: 'Sync logs' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border ${
              tab === t.id
                ? 'border-ch-pine bg-ch-pine text-white'
                : 'border-ch-line bg-white text-ch-pine'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {failedFeeds.length > 0 && tab === 'units' ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{failedFeeds.length} connection(s) failed</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {failedFeeds.slice(0, 5).map((f) => (
                <li key={f.id}>
                  {unitCode(f.unit)} · {f.platform}: {f.last_sync_error || 'Failed'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === 'providers' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ch-muted">
              API providers push availability/rates and pull reservations and messages when credentials
              are set.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setApiModal({ connectionId: null, providerKey: 'booking_api' })}
            >
              Add API connection
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {providers
              .filter((p) => p.connection_type === 'api')
              .map((p) => (
                <div key={p.key} className="rounded-2xl border border-ch-line bg-white p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ch-pine">{p.label}</p>
                    <span className="text-[11px] uppercase tracking-wide text-ch-muted">API</span>
                  </div>
                  <p className="text-[11px] text-ch-muted">
                    Capabilities: {(p.capabilities || []).join(', ') || 'none'}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-ch-pine hover:underline"
                    onClick={() => setApiModal({ connectionId: null, providerKey: p.key })}
                  >
                    Connect credentials
                  </button>
                </div>
              ))}
          </div>
          {apiConnections.length > 0 ? (
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <div className="px-4 py-2.5 border-b border-ch-line text-[11px] uppercase tracking-wider text-ch-muted font-semibold">
                Configured connections
              </div>
              <ul className="divide-y divide-ch-line">
                {apiConnections.map((c) => (
                  <li key={c.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ch-pine">{c.display_name}</p>
                      <p className="text-xs text-ch-muted">
                        {c.provider_label} · {c.has_credentials ? 'Credentials set' : 'Missing credentials'} ·{' '}
                        {(c.mappings || []).length} mapping{(c.mappings || []).length === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs text-ch-muted">
                        Last sync: {formatWhen(c.last_sync_at)}
                        {c.last_sync_error ? ` — ${c.last_sync_error}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={c.status} />
                      <button
                        type="button"
                        className="text-xs text-ch-pine hover:underline"
                        onClick={() => setApiModal({ connectionId: c.id })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs text-ch-pine hover:underline"
                        disabled={syncApiMutation.isPending}
                        onClick={() => syncApiMutation.mutate(c.id)}
                      >
                        Sync
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ch-muted">
              No API connections yet. Add Booking.com / Airbnb credentials above; until then configure
              iCal per unit under Unit mapping.
            </p>
          )}
        </div>
      ) : null}

      {tab === 'logs' ? (
        logsLoading ? (
          <div className="py-16 flex justify-center">
            <LoadingSpinner />
          </div>
        ) : (logsData?.logs || []).length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No sync logs yet"
            description="Run Sync now to pull channel availability and write logs."
          />
        ) : (
          <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
            <ul className="divide-y divide-ch-line">
              {(logsData?.logs || []).map((log) => (
                <li key={log.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-ch-pine">
                      {log.provider_key} · {log.operation}
                    </p>
                    <StatusBadge
                      status={
                        log.status === 'success'
                          ? 'connected'
                          : log.status === 'error'
                            ? 'failed'
                            : 'syncing'
                      }
                    />
                  </div>
                  <p className="text-xs text-ch-muted mt-1">
                    {formatWhen(log.created_at)} · {log.direction}
                    {log.message ? ` — ${log.message}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {tab === 'units' ? (
        <>
          <SearchFilter value={search} onChange={setSearch} placeholder="Search units…" />

          {isLoading ? (
            <div className="py-16 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No published units"
              description="Publish rental units to map channels."
            />
          ) : (
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1.1fr))] gap-2 px-4 py-2.5 border-b border-ch-line bg-[#f7f9fc] text-[11px] uppercase tracking-wider text-ch-muted font-semibold">
                <div>Unit</div>
                {PLATFORMS.map((p) => (
                  <div key={p.id} className="text-center">
                    {p.label}
                  </div>
                ))}
              </div>
              <ul className="divide-y divide-ch-line">
                {filtered.map((unit) => (
                  <li key={unit.id}>
                    <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1.1fr))] gap-2 items-center px-4 py-3 hover:bg-ch-pine-50/40">
                      <button type="button" onClick={() => openUnit(unit)} className="text-left min-w-0">
                        <p className="font-medium text-ch-pine truncate">{unitCode(unit)}</p>
                        {unit.title && unit.title !== unitCode(unit) ? (
                          <p className="text-xs text-ch-muted truncate">{unit.title}</p>
                        ) : null}
                      </button>
                      {PLATFORMS.map((p) => {
                        const feed = feedFor(unit, p.id);
                        return (
                          <div key={p.id} className="flex flex-col items-center gap-1.5 py-1">
                            <button type="button" onClick={() => openUnit(unit, p.id)}>
                              {feed ? (
                                <StatusBadge status={feed.status || 'disconnected'} />
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-ch-muted">
                                  <Unplug className="w-3 h-3" /> Unlinked
                                </span>
                              )}
                            </button>
                            {feed?.id ? (
                              <button
                                type="button"
                                className="text-[11px] text-ch-pine hover:underline"
                                disabled={syncFeedMutation.isPending}
                                onClick={() => syncFeedMutation.mutate(feed.id)}
                              >
                                Sync
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}

      {liveSelected && (
        <UnitDetailsModal
          unit={liveSelected}
          open
          focusPlatform={focusPlatform}
          onClose={() => {
            setSelected(null);
            setFocusPlatform(null);
          }}
        />
      )}

      {apiModal ? (
        <ApiConnectionModal
          open
          connection={liveApiConnection || null}
          units={units}
          providerKey={apiModal.providerKey}
          onClose={() => setApiModal(null)}
        />
      ) : null}
    </div>
  );
}
