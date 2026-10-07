import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, CalendarRange, Edit2, X, DollarSign, Eye, ExternalLink, Clock, Hourglass, Trash2, Plus, Ban, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { currency, formatDate, nightsText, BOOKING_SOURCES, unitDisplay, unitSelectLabel } from '../utils/formatters';
import { usePermissions } from '../hooks/usePermissions';
import { salesUsersForActor } from '../utils/permissions';
import SearchableSelect from '../components/ui/SearchableSelect';
import AdminReservationDrawer from '../components/AdminReservationDrawer';
import ManualReservationForm, {
  EMPTY_MANUAL_RESERVATION_FORM,
} from '../components/ManualReservationForm';
import { reservationCurrencyError, reservationMoney, toEgpPayload } from '../utils/reservationCurrency';
import TransferReservationModal from '../components/TransferReservationModal';
import { useAuth } from '../context/AuthContext';
import { isoDateOnly } from '../../utils/stayNights';
import { otaBlockRank, otaBlockLook } from '../utils/otaCalendar';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import './scheduleRack.css';




const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const todayStr = () => localISO(new Date());


const addDays = (d, n) => {
  const [y, m, day] = String(d).split('-').map(Number);
  return localISO(new Date(y, m - 1, day + n));
};

const addMonths = (d, n) => {
  const [y, m, day] = String(d).split('-').map(Number);
  return localISO(new Date(y, m - 1 + n, day));
};

const isoDate = (d) => localISO(d);

function getMonthDates(year, month) {
  const total = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: total }, (_, i) => new Date(year, month, i + 1));
}

function getWeekRange(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: isoDate(mon), to: isoDate(sun) };
}
function getMonthRange(dateStr) {
  const d = new Date(dateStr);
  return {
    from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)),
    to:   isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}


const normDate = (d) => isoDateOnly(d);



function buildRow(unitId, dates, reservations) {
  const unitRes = reservations
    .filter((r) => r.unit_id === unitId)
    .map((r) => ({ ...r, check_in: normDate(r.check_in), check_out: normDate(r.check_out) }));

  const cells = [];
  let i = 0;

  while (i < dates.length) {
    const dStr = isoDate(dates[i]);

    
    const covering = unitRes.find((r) => r.check_in < dStr && r.check_out > dStr);
    if (covering) {
      let span = 0;
      const midStart = dStr;
      while (i < dates.length) {
        const d = isoDate(dates[i]);
        if (!(covering.check_in < d && covering.check_out > d)) break;
        span++;
        i++;
      }
      cells.push({ type: 'mid', res: covering, span, firstDate: midStart, unitId });
      continue;
    }

    const starting = unitRes.find((r) => r.check_in === dStr);
    const ending = unitRes.find((r) => r.check_out === dStr);

    
    if (starting && ending && starting.id !== ending.id) {
      cells.push({
        type: 'turnover',
        outRes: ending,
        inRes: starting,
        date: dStr,
        unitId,
      });
      i++;
      continue;
    }

    if (starting) {
      cells.push({ type: 'checkin', res: starting, date: dStr, unitId });
      i++;
      continue;
    }

    
    if (ending) {
      cells.push({ type: 'checkout', res: ending, date: dStr, unitId });
      i++;
      continue;
    }

    cells.push({ type: 'price', date: dStr, unitId });
    i++;
  }

  return cells;
}


function rackBarClass(res, today) {
  const tomorrow = addDays(today, 1);
  const co = normDate(res.check_out);
  const ci = normDate(res.check_in);
  if (res.status === 'cancelled') return 'rack-bar--cancelled';
  if (res.is_hold || res.status === 'hold') return 'rack-bar--hold';
  if (co < today) return 'rack-bar--past';
  if (co === tomorrow) return 'rack-bar--departure';
  if (ci === tomorrow) return 'rack-bar--arrival';
  if (res.is_owner_reservation && parseFloat(res.total_amount) === 0) return 'rack-bar--blocked';
  if (res.is_owner_reservation) return 'rack-bar--owner';
  if (ci <= today) return 'rack-bar--inhouse';
  return 'rack-bar--future';
}

function rackTip(res) {
  return `${res.status === 'cancelled' ? 'CANCELLED · ' : ''}${res.guest_name || ''}\n${formatDate(
    normDate(res.check_in)
  )} → ${formatDate(normDate(res.check_out))}`;
}

function shortPrice(price) {
  return price >= 1000 ? `${(price / 1000).toFixed(price % 1000 === 0 ? 0 : 1)}k` : price;
}

const RACK_LEGEND = [
  { cls: 'rack-bar--inhouse', label: 'In house' },
  { cls: 'rack-bar--future', label: 'Upcoming' },
  { cls: 'rack-bar--arrival', label: 'Arrives tomorrow' },
  { cls: 'rack-bar--departure', label: 'Leaves tomorrow' },
  { cls: 'rack-bar--hold', label: 'Hold' },
  { cls: 'rack-bar--owner', label: 'Owner' },
  { cls: 'rack-bar--blocked', label: 'Blocked' },
  { cls: 'rack-bar--cancelled', label: 'Cancelled' },
  { cls: 'rack-bar--past', label: 'Checked out' },
  { cls: 'rack-cell--unpriced', label: 'No price' },
  { cls: 'rack-cell--lt', label: 'Long-term' },
];

const COLOR_FILTERS = [
  { value: '', label: 'All stays' },
  { value: 'hold', label: 'Holds' },
  { value: 'owner', label: 'Owner reservations' },
  { value: 'sales', label: 'Guest / sales' },
  { value: 'blocked', label: 'Blocked nights' },
  { value: 'checkin_tomorrow', label: 'Check-in tomorrow' },
  { value: 'checkout_tomorrow', label: 'Check-out tomorrow' },
  { value: 'past', label: 'Past stays' },
];

const CELL_W = 'var(--rack-cell-w)';


function PriceEditorModal({
  open,
  onClose,
  unitId,
  unitName,
  dateStr,
  presetFrom,
  presetTo,
  currentPrice,
  blockSource,
  onSave,
  onClear,
  onBlock,
  onUnblock,
  saving,
}) {
  const [price, setPrice] = useState('');
  const [applyTo, setApplyTo] = useState('day');
  const [rangeFrom, setRangeFrom] = useState(dateStr || '');
  const [rangeTo, setRangeTo]   = useState(dateStr || '');

  
  useEffect(() => {
    setPrice(currentPrice ? String(currentPrice) : '');
    const from = presetFrom || dateStr || '';
    const to = presetTo || dateStr || '';
    const multi = from && to && from !== to;
    setApplyTo(multi ? 'range' : 'day');
    setRangeFrom(from);
    setRangeTo(to);
  }, [open, dateStr, currentPrice, presetFrom, presetTo]);

  const getRange = () => {
    if (applyTo === 'day')    return { from: dateStr, to: dateStr };
    if (applyTo === 'week')   return getWeekRange(dateStr);
    if (applyTo === 'month')  return getMonthRange(dateStr);
    return { from: rangeFrom, to: rangeTo };
  };

  const removableBlock =
    !!blockSource && blockSource !== 'reservation';
  const lockedBlock = blockSource === 'reservation';

  const handleSave = () => {
    const p = parseFloat(price);
    if (!p || p <= 0) { toast.error('Enter a valid price'); return; }
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onSave(unitId, from, to, p);
  };

  const handleClear = () => {
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onClear(unitId, from, to);
  };

  const handleBlock = () => {
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onBlock(unitId, from, to);
  };

  const handleUnblock = () => {
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onUnblock(unitId, from, to);
  };

  const otaLook = otaBlockLook(blockSource);
  const blockLabel =
    otaLook
      ? otaLook.label
      : blockSource === 'owner'
        ? 'Owner block'
        : blockSource === 'reservation'
          ? 'Reservation'
          : blockSource === 'manual'
            ? 'Manual block'
            : blockSource === 'csv_import' || blockSource === 'ch_availability_xlsx'
              ? 'Imported block'
              : blockSource
                ? `${blockSource} block`
                : null;

  return (
    <Modal open={open} onClose={onClose} title="Edit night" size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        {currentPrice > 0 && (
          <button onClick={handleClear} disabled={saving} className="btn-secondary text-rose-700 border-rose-200 hover:bg-rose-50">
            Clear price
          </button>
        )}
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <DollarSign className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Apply price'}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-ch-line bg-[#f7f9fc] px-4 py-3">
          <p className="text-sm font-semibold text-ch-pine">{unitName}</p>
          <p className="mt-0.5 text-xs text-ch-muted">
            {formatDate(dateStr)}
            {currentPrice > 0 ? ` · Current ${currency(currentPrice)}` : ' · Unpriced'}
            {blockLabel && !otaLook ? ` · ${blockLabel}` : ''}
          </p>
          {otaLook && (
            <div
              className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 ring-1 ring-inset"
              style={{ backgroundImage: otaLook.hatch }}
            >
              <span className={`rounded px-1 text-[10px] font-black tracking-widest ${otaLook.badgeClass}`}>
                {otaLook.badge}
              </span>
              <span className="text-[11px] font-semibold text-slate-800">{blockLabel}</span>
            </div>
          )}
        </div>

        <div>
          <label className="label">Price per night (EGP)</label>
          <input type="number" min="0" step="0.01" autoFocus className="input text-lg font-semibold"
            value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </div>

        <div>
          <label className="label">Apply to</label>
          <div className="grid grid-cols-2 gap-2">
            {[['day','This day'],['week','This week'],['month','This month'],['range','Custom range']].map(([v,l]) => (
              <button key={v} onClick={() => setApplyTo(v)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${applyTo === v ? 'border-[var(--pms-accent,#2f5d58)] bg-[var(--pms-accent,#2f5d58)] text-white shadow-sm' : 'border-ch-line text-ch-pine hover:bg-slate-50'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {applyTo === 'range' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">From</label><input type="date" className="input" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} /></div>
            <div><label className="label">To</label><input type="date" className="input" value={rangeTo}   onChange={e => setRangeTo(e.target.value)}   /></div>
          </div>
        )}

        {applyTo !== 'day' && applyTo !== 'range' && (
          <p className="text-xs text-ch-muted">
            {applyTo === 'week'  && `Mon – Sun of the week containing ${formatDate(dateStr)}`}
            {applyTo === 'month' && `All days of ${new Date(dateStr).toLocaleDateString('en-US',{month:'long',year:'numeric'})}`}
          </p>
        )}

        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-900">
            <Ban className="h-3.5 w-3.5" />
            Calendar block
          </div>
          <p className="text-xs text-violet-800">
            Blocks close the night to guests without creating a reservation. Reservation nights stay booked until cancelled.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBlock}
              disabled={saving || lockedBlock}
              className="btn-secondary border-violet-300 text-violet-800 hover:bg-violet-100 disabled:opacity-40"
            >
              Block nights
            </button>
            <button
              type="button"
              onClick={handleUnblock}
              disabled={saving || lockedBlock}
              className="btn-secondary text-rose-700 border-rose-200 hover:bg-rose-50 disabled:opacity-40"
              title={
                lockedBlock
                  ? 'Cancel the reservation to free this night'
                  : removableBlock
                    ? 'Remove calendar block for this range'
                    : 'Clear any calendar blocks in the selected range'
              }
            >
              Unblock nights
            </button>
          </div>
          {lockedBlock && (
            <p className="text-[11px] font-medium text-rose-700">
              This night is held by a reservation. Cancel or edit that booking to free it.
            </p>
          )}
        </div>

        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          Clearing a price marks the night unpriced — guests see it as unavailable.
        </p>
      </div>
    </Modal>
  );
}


function ReservationDetailModal({
  open,
  onClose,
  reservationId,
  seed,
  unitName,
  canWrite,
  onMoveUnit,
  onEdit,
  onCancel,
  onDelete,
  cancelling,
  deleting,
}) {
  const isWebsitePending = String(reservationId || '').startsWith('web-');
  const numericId = isWebsitePending ? null : reservationId;

  const { data: fetched, isLoading } = useQuery({
    queryKey: ['reservation-detail', numericId],
    queryFn: () => api.get(`/reservations/${numericId}`).then((r) => r.data),
    enabled: !!numericId && open && !isWebsitePending,
    retry: 1,
  });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const res = fetched || seed;
  const paid = parseFloat(res?.amount_paid) || 0;
  const total = parseFloat(res?.total_amount) || 0;
  const remaining = Math.max(0, total - paid);
  const cancelled = String(res?.status || '').toLowerCase() === 'cancelled';
  const isOwner = Number(res?.is_owner_reservation) === 1;
  const canAct = canWrite && res && !cancelled && !isWebsitePending;

  const rows = res
    ? [
        ['Guest name', res.guest_name],
        [
          'Phone',
          res.guest_phone ? (
            <a href={`tel:${res.guest_phone}`} className="text-[#185c37] underline underline-offset-2">
              {res.guest_phone}
            </a>
          ) : null,
        ],
        ['Unit', unitName || res.unit_title || res.unit_name],
        ['Check-in', formatDate(res.check_in)],
        ['Check-out', formatDate(res.check_out)],
        ['Paid', reservationMoney(paid, res)],
        [
          'To collect',
          <span className={remaining > 0 ? 'text-[#9c0006]' : 'text-[#006100]'}>
            {reservationMoney(remaining, res)}
          </span>,
        ],
      ]
    : [];

  return createPortal(
    <div className="rack rack-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rack-window rack-dialog" role="dialog" aria-modal="true">
        <div className="rack-titlebar">
          <span>Reservation{cancelled ? ' (cancelled)' : ''}</span>
          <button type="button" className="rack-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="rack-dialog-body">
          {isLoading && !res ? (
            <p className="py-6 text-center">Loading…</p>
          ) : res ? (
            <div className="rack-dialog-sheet">
              {rows.map(([label, value]) => (
                <div key={label} className="rack-dialog-row">
                  <span className="rack-dialog-label">{label}</span>
                  <span className="rack-dialog-value">{value || '—'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center">Reservation not found</p>
          )}
        </div>
        <div className="rack-dialog-actions">
          {canAct && (
            <>
              <button
                type="button"
                className="rack-btn rack-btn--danger sm:mr-auto"
                disabled={cancelling || deleting}
                onClick={() => onCancel?.(res)}
              >
                Cancel booking
              </button>
              <button
                type="button"
                className="rack-btn rack-btn--danger"
                disabled={cancelling || deleting}
                onClick={() => onDelete?.(res)}
              >
                Delete
              </button>
              {!isOwner && (
                <button type="button" className="rack-btn" onClick={() => onMoveUnit?.(res)}>
                  Move unit
                </button>
              )}
              <button type="button" className="rack-btn" onClick={() => onEdit?.(res)}>
                Edit
              </button>
            </>
          )}
          <button type="button" className="rack-btn rack-btn--primary min-w-[72px]" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


function EditReservationModal({ open, onClose, editId, editForm, setEditForm, unitsList, usersList, onSave, saving }) {
  return (
    <Modal open={open} onClose={onClose} title={`Edit Reservation #${editId}`} size="lg"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={onSave} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save Changes'}</button>
      </>}
    >
      <div className="space-y-4">
        <div className="form-grid">
          <div>
            <label className="label">Unit *</label>
            <SearchableSelect value={editForm.unit_id} onChange={v => setEditForm(f => ({ ...f, unit_id: v }))}
              placeholder="Select…"
              options={[{ value: '', label: 'Select…' }, ...unitsList.map(u => ({ value: String(u.id), label: unitSelectLabel(u) }))]}
            />
          </div>
          <div><label className="label">Tenant Name *</label><input className="input" value={editForm.guest_name} onChange={e => setEditForm(f => ({ ...f, guest_name: e.target.value }))} /></div>
          <div><label className="label">Phone</label><input className="input" value={editForm.guest_phone} onChange={e => setEditForm(f => ({ ...f, guest_phone: e.target.value }))} /></div>
          <div>
            <label className="label">Adults</label>
            <input type="number" min="0" className="input" value={editForm.adults ?? '2'} onChange={e => setEditForm(f => ({ ...f, adults: e.target.value }))} />
          </div>
          <div>
            <label className="label">Children</label>
            <input type="number" min="0" className="input" value={editForm.children ?? '0'} onChange={e => setEditForm(f => ({ ...f, children: e.target.value }))} />
          </div>
          <div>
            <label className="label">Nanny</label>
            <input type="number" min="0" className="input" value={editForm.nanny_count ?? '0'} onChange={e => setEditForm(f => ({ ...f, nanny_count: e.target.value }))} />
          </div>
          <div>
            <label className="label">Booking Source</label>
            <SearchableSelect value={editForm.booking_source} onChange={v => setEditForm(f => ({ ...f, booking_source: v }))}
              placeholder="Select…"
              options={[{ value: '', label: 'Select…' }, ...BOOKING_SOURCES.map(s => ({ value: s, label: s }))]}
            />
          </div>
          <div><label className="label">Check-in *</label><input type="date" className="input" value={editForm.check_in} onChange={e => setEditForm(f => ({ ...f, check_in: e.target.value }))} /></div>
          <div><label className="label">Check-out *</label><input type="date" className="input" value={editForm.check_out} onChange={e => setEditForm(f => ({ ...f, check_out: e.target.value }))} /></div>
          <div><label className="label">Total (EGP)</label><input type="number" min="0" step="0.01" className="input" value={editForm.total_amount} onChange={e => setEditForm(f => ({ ...f, total_amount: e.target.value }))} /></div>
          <div>
            <label className="label">Status</label>
            <SearchableSelect value={editForm.status} onChange={v => setEditForm(f => ({ ...f, status: v }))}
              placeholder="Select…"
              options={['confirmed','checked_in','checked_out','cancelled'].map(s => ({ value: s, label: s.replace(/_/g,' ') }))}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="owner_sched" checked={!!editForm.is_owner_reservation} onChange={e => setEditForm(f => ({ ...f, is_owner_reservation: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
          <label htmlFor="owner_sched" className="text-sm text-gray-700 font-medium">Owner Reservation</label>
        </div>
        <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} /></div>
      </div>
    </Modal>
  );
}


function HoldModal({ open, onClose, prefillUnit, prefillCheckIn, prefillCheckOut, unitsList, onSave, saving }) {
  const [unitId,     setUnitId]     = useState('');
  const [guestName,  setGuestName]  = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [checkIn,    setCheckIn]    = useState('');
  const [checkOut,   setCheckOut]   = useState('');
  const [preset,     setPreset]     = useState('24'); 
  const [customH,    setCustomH]    = useState('');

  useEffect(() => {
    if (open) {
      setUnitId(prefillUnit || '');
      setCheckIn(prefillCheckIn || '');
      setCheckOut(prefillCheckOut || '');
      setGuestName(''); setGuestPhone(''); setPreset('24'); setCustomH('');
    }
  }, [open, prefillUnit, prefillCheckIn, prefillCheckOut]);

  const hours = preset === 'custom' ? (parseInt(customH) || 24) : parseInt(preset);

  const holdUntilLabel = (() => {
    const d = new Date(Date.now() + hours * 3600000);
    return d.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  })();

  const handleSave = () => {
    if (!unitId || !checkIn || !checkOut) { toast.error('Unit, check-in, check-out required'); return; }
    if (checkOut <= checkIn) { toast.error('Check-out must be after check-in'); return; }
    onSave({ unit_id: unitId, guest_name: guestName || 'Hold', guest_phone: guestPhone || undefined, check_in: checkIn, check_out: checkOut, is_hold: '1', hold_hours: String(hours) });
  };

  return (
    <Modal open={open} onClose={onClose} title="🟡 Add Hold" size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <Hourglass className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Create Hold'}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5 text-xs text-yellow-800">
          الهولد بيحجز التواريخ مؤقتاً. لو ماتأكدش في المدة المحددة هيتشال أوتوماتيك.
        </div>

        <div>
          <label className="label">Unit *</label>
          <SearchableSelect value={unitId} onChange={setUnitId} placeholder="Select unit…"
            options={[{ value:'', label:'Select…' }, ...unitsList.map(u => ({ value: String(u.id), label: unitSelectLabel(u, { withProject: false }) }))]}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Check-in *</label>
            <input type="date" className="input" value={checkIn} onChange={e => setCheckIn(e.target.value)} /></div>
          <div><label className="label">Check-out *</label>
            <input type="date" className="input" value={checkOut} onChange={e => setCheckOut(e.target.value)} /></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Guest Name (optional)</label>
            <input type="text" className="input" placeholder="Hold" value={guestName} onChange={e => setGuestName(e.target.value)} /></div>
          <div><label className="label">Phone (optional)</label>
            <input type="text" className="input" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} /></div>
        </div>

        <div>
          <label className="label">Hold Duration</label>
          <div className="flex gap-2 flex-wrap">
            {[['24','24 hours'],['48','48 hours'],['72','72 hours'],['custom','Custom']].map(([v,l]) => (
              <button key={v} type="button" onClick={() => setPreset(v)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors
                  ${preset === v ? 'bg-yellow-400 text-yellow-900 border-yellow-400' : 'border-gray-200 text-gray-600 hover:border-yellow-300'}`}>
                {l}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" min="1" max="720" className="input w-24 text-center"
                placeholder="24" value={customH} onChange={e => setCustomH(e.target.value)} />
              <span className="text-sm text-gray-500">hours</span>
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-gray-500">
          <Clock className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
          Hold expires: <span className="font-semibold text-yellow-700">{holdUntilLabel}</span>
        </div>
      </div>
    </Modal>
  );
}


function HoldDetailModal({ open, onClose, holdId, onConfirm, onDelete, deleting }) {
  const { data: hold, isLoading } = useQuery({
    queryKey: ['hold-detail', holdId],
    queryFn: () => api.get(`/reservations/${holdId}`).then(r => r.data),
    enabled: !!holdId && open,
    refetchInterval: open ? 30000 : false, 
  });

  const now = new Date();
  const holdUntil = hold?.hold_until ? new Date(hold.hold_until) : null;
  const msLeft = holdUntil ? holdUntil - now : null;
  const isExpired = msLeft !== null && msLeft <= 0;

  const timeLeftStr = (() => {
    if (!msLeft || isExpired) return 'Expired';
    const h = Math.floor(msLeft / 3600000);
    const m = Math.floor((msLeft % 3600000) / 60000);
    if (h >= 24) return `${Math.floor(h/24)}d ${h%24}h remaining`;
    return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`;
  })();

  return (
    <Modal open={open} onClose={onClose} title={`Hold #${holdId}`} size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Close</button>
        {hold && !isExpired && (
          <button onClick={() => onConfirm(hold)} className="btn-primary">
            <Eye className="w-3.5 h-3.5" />Confirm as Reservation
          </button>
        )}
      </>}
    >
      {isLoading ? <div className="py-8 text-center text-gray-400 text-sm">Loading…</div> : hold ? (
        <div className="space-y-4">
          <div className={`rounded-lg px-4 py-3 flex items-center gap-3 ${isExpired ? 'bg-red-50 border border-red-100' : 'bg-yellow-50 border border-yellow-200'}`}>
            <Clock className={`w-5 h-5 flex-shrink-0 ${isExpired ? 'text-red-400' : 'text-yellow-500'}`} />
            <div>
              <p className={`font-semibold text-sm ${isExpired ? 'text-red-600' : 'text-yellow-800'}`}>{timeLeftStr}</p>
              <p className="text-xs text-gray-400">
                Expires: {holdUntil?.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex gap-2"><span className="text-gray-400 w-20">Unit:</span><span className="font-medium">{unitDisplay(hold)}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-20">Guest:</span><span>{hold.guest_name}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-20">Check-in:</span><span>{formatDate(hold.check_in)}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-20">Check-out:</span><span>{formatDate(hold.check_out)}</span></div>
            <div className="flex gap-2"><span className="text-gray-400 w-20">Nights:</span><span>{nightsText(hold.nights)}</span></div>
            {hold.guest_phone && <div className="flex gap-2"><span className="text-gray-400 w-20">Phone:</span><span>{hold.guest_phone}</span></div>}
          </div>

          <button onClick={() => onDelete(holdId)} disabled={deleting}
            className="w-full btn-danger flex items-center justify-center gap-2 text-sm">
            <Trash2 className="w-3.5 h-3.5" />{deleting ? 'Deleting…' : 'Delete Hold'}
          </button>
        </div>
      ) : <p className="text-gray-400 text-center py-8 text-sm">Hold not found</p>}
    </Modal>
  );
}


const EMPTY_EDIT = {
  unit_id: '', guest_name: '', guest_email: '', guest_phone: '', guest_nationality: '',
  adults: '2', children: '0', nanny_count: '0',
  check_in: '', check_out: '', total_amount: '', price_per_night: '',
  booking_source: '', sales_person_id: '', is_owner_reservation: false, is_hold: false,
  status: 'confirmed', notes: '',
};

function BulkPriceModal({ open, onClose, unitCount, onSave, saving }) {
  const [price,     setPrice]     = useState('');
  const [applyTo,   setApplyTo]   = useState('day');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo,   setRangeTo]   = useState('');

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (open) { setPrice(''); setApplyTo('day'); setRangeFrom(today); setRangeTo(today); }
  }, [open]);

  const getRange = () => {
    if (applyTo === 'day')   return { from: today, to: today };
    if (applyTo === 'week')  return getWeekRange(today);
    if (applyTo === 'month') return getMonthRange(today);
    return { from: rangeFrom, to: rangeTo };
  };

  const handleSave = () => {
    const p = parseFloat(price);
    if (!p || p <= 0) { toast.error('Enter a valid price'); return; }
    const { from, to } = getRange();
    if (!from || !to || from > to) { toast.error('Invalid date range'); return; }
    onSave(from, to, p);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Bulk price · ${unitCount} unit${unitCount !== 1 ? 's' : ''}`} size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving || unitCount === 0} className="btn-primary">
          <DollarSign className="w-3.5 h-3.5" />{saving ? 'Saving…' : `Apply to ${unitCount}`}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-ch-line bg-[#f7f9fc] px-4 py-3 text-sm text-ch-pine">
          Price will apply to <strong>{unitCount}</strong> selected unit{unitCount !== 1 ? 's' : ''}.
        </div>

        <div>
          <label className="label">Price per night (EGP)</label>
          <input type="number" min="0" step="0.01" autoFocus className="input text-lg font-semibold"
            value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </div>

        <div>
          <label className="label">Apply to</label>
          <div className="grid grid-cols-2 gap-2">
            {[['day','Today'],['week','This week'],['month','This month'],['range','Custom range']].map(([v,l]) => (
              <button key={v} onClick={() => setApplyTo(v)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${applyTo === v ? 'border-[var(--pms-accent,#2f5d58)] bg-[var(--pms-accent,#2f5d58)] text-white shadow-sm' : 'border-ch-line text-ch-pine hover:bg-slate-50'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {applyTo === 'range' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">From</label><input type="date" className="input" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} /></div>
            <div><label className="label">To</label><input type="date" className="input" value={rangeTo} onChange={e => setRangeTo(e.target.value)} /></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Schedule() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditSchedulePricing, canManageReservations, canReserveLongTermUnits, canWriteSchedule, isManualReservations, isWebsiteReservations, isReservationsManager, isAdmin } = usePermissions();
  const TODAY = todayStr();
  const TOMORROW = addDays(TODAY, 1);
  const [viewStart, setViewStart] = useState(TODAY);
  const [spanMonths, setSpanMonths] = useState(2);

  
  const [createDrawer, setCreateDrawer] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_MANUAL_RESERVATION_FORM });
  const [createProof, setCreateProof] = useState(null);
  const dragSelectRef = useRef(null);
  const dragHintRef = useRef(null);
  const dragRafRef = useRef(0);
  const suppressClickRef = useRef(false);
  const [rangeAction, setRangeAction] = useState(null);

  
  const [filterBedrooms,  setFilterBedrooms]  = useState('');
  const [filterProject,   setFilterProject]   = useState('');
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');
  const [filterColor,     setFilterColor]     = useState('');
  const [filterUnits,     setFilterUnits]     = useState([]);   
  const [filterFloor,     setFilterFloor]     = useState('');
  const [filterPriceMin,  setFilterPriceMin]  = useState('');
  const [filterPriceMax,  setFilterPriceMax]  = useState('');
  const [filterAvailable, setFilterAvailable] = useState(false);
  const [unitPickerOpen,  setUnitPickerOpen]  = useState(false);
  const [unitPickerSearch, setUnitPickerSearch] = useState('');
  const unitPickerRef = useRef(null);
  useEffect(() => {
    if (!unitPickerOpen) return;
    const handler = (e) => { if (unitPickerRef.current && !unitPickerRef.current.contains(e.target)) { setUnitPickerOpen(false); setUnitPickerSearch(''); } };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [unitPickerOpen]);

  
  const [priceModal,        setPriceModal]        = useState(false);
  const [priceCell,         setPriceCell]         = useState(null); 

  
  const [bulkMode,          setBulkMode]          = useState(false);
  const [selectedUnitIds,   setSelectedUnitIds]   = useState(new Set());
  const [bulkPriceModal,    setBulkPriceModal]    = useState(false);

  
  const [detailModal,       setDetailModal]       = useState(false);
  const [detailResId,       setDetailResId]       = useState(null);
  const [detailSeed,        setDetailSeed]        = useState(null);
  const [cancelConfirmId,   setCancelConfirmId]   = useState(null);
  const [deleteConfirmId,   setDeleteConfirmId]   = useState(null);
  const [transferRes,       setTransferRes]       = useState(null);

  
  const [editModal,         setEditModal]         = useState(false);
  const [editId,            setEditId]            = useState(null);
  const [editForm,          setEditForm]          = useState(EMPTY_EDIT);

  
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [guestSearch, setGuestSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  
  const [holdModal,         setHoldModal]         = useState(false);
  const [holdPrefill,       setHoldPrefill]       = useState({});
  const [holdDetailModal,   setHoldDetailModal]   = useState(false);
  const [holdDetailId,      setHoldDetailId]      = useState(null);

  
  const defaultFrom = viewStart;
  const defaultTo   = addMonths(viewStart, spanMonths);

  
  
  
  const { fromStr, toStr } = useMemo(() => {
    const monthStart = (dateStr) => {
      const [y, m] = String(dateStr).split('-').map(Number);
      return isoDate(new Date(y, m - 1, 1));
    };
    const monthEnd = (dateStr, months) => {
      const [y, m] = String(dateStr).split('-').map(Number);
      return isoDate(new Date(y, m - 1 + months, 1));
    };

    if (filterFrom && filterTo) {
      const start = filterFrom <= filterTo ? filterFrom : filterTo;
      const end   = filterFrom <= filterTo ? filterTo : filterFrom;
      return { fromStr: start, toStr: addDays(end, 1) };
    }
    if (filterFrom) {
      return { fromStr: filterFrom, toStr: monthEnd(filterFrom, spanMonths) };
    }
    if (filterTo) {
      return { fromStr: monthStart(filterTo), toStr: addDays(filterTo, 1) };
    }
    return { fromStr: defaultFrom, toStr: defaultTo };
  }, [filterFrom, filterTo, defaultFrom, defaultTo, spanMonths]);

  const displayDates = useMemo(() => {
    const days = [];
    for (let d = new Date(`${fromStr}T00:00:00`); isoDate(d) < toStr; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    return days;
  }, [fromStr, toStr]);

  const monthLabel = useMemo(() => {
    const fmt = (s) =>
      new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    const last = addDays(addMonths(viewStart, spanMonths), -1);
    return `${fmt(viewStart)} – ${fmt(last)} ${last.slice(0, 4)}`;
  }, [viewStart, spanMonths]);

  
  const { data, isLoading } = useQuery({
    queryKey: ['schedule', fromStr, toStr, filterBedrooms, filterProject],
    queryFn: () => api.get('/reservations/schedule', {
      params: { from_date: fromStr, to_date: toStr, bedrooms: filterBedrooms || undefined, project: filterProject || undefined },
    }).then(r => r.data),
  });

  const { data: dailyPricesRaw = [] } = useQuery({
    queryKey: ['daily-prices', fromStr, toStr],
    queryFn: () => api.get('/daily-prices', { params: { from_date: fromStr, to_date: toStr } }).then(r => r.data),
  });

  const { data: calendarBlocks = [] } = useQuery({
    queryKey: ['calendar-blocks', fromStr, toStr],
    queryFn: () => api.get('/calendar-blocks', { params: { from: fromStr, to: toStr } }).then(r => r.data),
  });

  const blockMap = useMemo(() => {
    const m = {};
    const priority = {
      reservation: 3,
      booking: 3,
      owner: 1,
      manual: 1,
      csv_import: 1,
      ch_availability_xlsx: 1,
    };
    for (const b of calendarBlocks) {
      if (!m[b.unit_id]) m[b.unit_id] = {};
      const dateKey = String(b.date).split('T')[0];
      const prev = m[b.unit_id][dateKey];
      const prevRank = priority[prev] ?? otaBlockRank(prev);
      const nextRank = priority[b.source] ?? otaBlockRank(b.source);

      if (!prev || nextRank >= prevRank) {
        m[b.unit_id][dateKey] = b.source;
      }
    }
    return m;
  }, [calendarBlocks]);

  const priceMap = useMemo(() => {
    const m = {};
    dailyPricesRaw.forEach(dp => {
      if (!m[dp.unit_id]) m[dp.unit_id] = {};
      
      const dateKey = String(dp.date).split('T')[0];
      m[dp.unit_id][dateKey] = parseFloat(dp.price);
    });
    return m;
  }, [dailyPricesRaw]);

  const getUnitDayPrice = (unit, dateStr) => {
    if (priceMap[unit.id]?.[dateStr] != null) return priceMap[unit.id][dateStr];
    
    return priceMap[unit.id]?.[dateStr] ?? null;
  };

  const { projectNames: projectsList } = useProjectCatalog();
  const { data: unitsList     = [] } = useQuery({ queryKey: ['units'],    queryFn: () => api.get('/units').then(r => r.data) });
  const bookableUnitsList = useMemo(
    () => (canReserveLongTermUnits ? unitsList : unitsList.filter((u) => u.listing_type !== 'long_term')),
    [unitsList, canReserveLongTermUnits]
  );
  const { data: usersList     = [] } = useQuery({ queryKey: ['users-sales'], queryFn: () => api.get('/users/sales').then(r => r.data) });
  const salesUsers = useMemo(() => salesUsersForActor(usersList, user), [usersList, user]);

  
  const priceMutation = useMutation({
    mutationFn: ({ unit_id, from_date, to_date, price, clear }) =>
      api.post('/daily-prices/batch', { unit_id, from_date, to_date, price, clear: !!clear }),
    onSuccess: (_, { unit_id, from_date, to_date, price, clear }) => {
      const updatedDates = [];
      const [fy, fm, fd] = String(from_date).split('-').map(Number);
      const [ty, tm, td] = String(to_date).split('-').map(Number);
      const cur = new Date(fy, fm - 1, fd);
      const end = new Date(ty, tm - 1, td);
      while (cur <= end) {
        updatedDates.push(localISO(cur));
        cur.setDate(cur.getDate() + 1);
      }
      const updatedSet = new Set(updatedDates);

      qc.setQueryData(['daily-prices', fromStr, toStr], (old = []) => {
        const kept = old.filter(dp =>
          !(dp.unit_id === unit_id && updatedSet.has(String(dp.date).split('T')[0]))
        );
        if (clear) return kept;
        const fresh = updatedDates.map(date => ({
          unit_id,
          date,
          price: parseFloat(price),
        }));
        return [...kept, ...fresh];
      });

      toast.success(clear ? 'Price cleared — nights blocked for guests' : 'Price updated');
      setPriceModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving price'),
  });

  const blockMutation = useMutation({
    mutationFn: ({ unit_id, from_date, to_date, clear }) =>
      api.put(`/blocked-dates/${unit_id}`, {
        from_date,
        to_date,
        clear: !!clear,
      }),
    onSuccess: (res, { clear }) => {
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      if (clear) {
        const still = res?.data?.still_reserved || [];
        if (still.length) {
          toast.success(
            `Unblocked calendar nights. ${still.length} night${still.length === 1 ? '' : 's'} still held by reservation(s).`
          );
        } else {
          toast.success('Nights unblocked');
        }
      } else {
        toast.success('Nights blocked');
      }
      setPriceModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error updating blocks'),
  });

  const editMutation = useMutation({
    mutationFn: () => api.put(`/reservations/${editId}`, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['reservation-detail', editId] });
      toast.success('Reservation updated');
      setEditModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const holdMutation = useMutation({
    mutationFn: (data) => api.post('/reservations', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Hold created');
      setHoldModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error creating hold'),
  });

  const createReservationMutation = useMutation({
    mutationFn: (d) => {
      if (d instanceof FormData) {
        return api.post('/reservations', d, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      return api.post('/reservations', d);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      toast.success('Reservation created — pending payment');
      setCreateDrawer(false);
      setCreateProof(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error creating reservation'),
  });

  const openCreateDrawer = (prefill = {}) => {
    setCreateForm({
      ...EMPTY_MANUAL_RESERVATION_FORM,
      sales_person_id: !isAdmin && user?.id ? String(user.id) : '',
      payment_method: 'cash',
      ...prefill,
    });
    setCreateProof(null);
    setCreateDrawer(true);
    dragSelectRef.current = null;
  };

  const handleCreateReservation = () => {
    if (!createForm.guest_phone?.trim()) return toast.error('Mobile number is required');
    if (!createForm.is_owner_reservation && !createForm.sales_person_id) {
      return toast.error('Please select a Sales Person or mark as Owner Reservation');
    }
    if (!createForm.unit_id || !createForm.check_in || !createForm.check_out) {
      return toast.error('Unit and dates are required');
    }
    const adults = Math.max(0, parseInt(createForm.adults, 10) || 0);
    const children = Math.max(0, parseInt(createForm.children, 10) || 0);
    const nannyCount = Math.max(0, parseInt(createForm.nanny_count, 10) || 0);
    if (!createForm.is_owner_reservation && adults < 1) {
      return toast.error('At least 1 adult is required');
    }
    const currencyError = reservationCurrencyError(createForm);
    if (currencyError) return toast.error(currencyError);
    const payload = {
      ...toEgpPayload(createForm),
      adults,
      children,
      nanny_count: nannyCount,
      beach_access_fees: createForm.is_owner_reservation
        ? 0
        : createForm.beach_access_fees !== '' && createForm.beach_access_fees != null
          ? Number(createForm.beach_access_fees)
          : undefined,
    };
    if (createProof) {
      const fd = new FormData();
      Object.entries(payload).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) {
          fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
        }
      });
      fd.append('transfer_proof', createProof);
      createReservationMutation.mutate(fd);
    } else {
      createReservationMutation.mutate(payload);
    }
  };

  const deleteHoldMutation = useMutation({
    mutationFn: (id) => api.delete(`/reservations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Hold deleted');
      setHoldDetailModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting hold'),
  });

  const cancelReservationMutation = useMutation({
    mutationFn: ({ id, reason }) =>
      api.post(`/reservations/${id}/cancel-request`, {
        reason: reason || 'Cancelled from schedule',
        cancel_type: 'non_refundable',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['reservation-detail'] });
      toast.success('Reservation cancelled');
      setCancelConfirmId(null);
      setDetailModal(false);
      setDetailSeed(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error cancelling reservation'),
  });

  const deleteReservationMutation = useMutation({
    mutationFn: (id) => api.delete(`/reservations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['reservation-detail'] });
      toast.success('Reservation deleted');
      setDeleteConfirmId(null);
      setDetailModal(false);
      setDetailSeed(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting reservation'),
  });

  
  const goPrevMonth = () => setViewStart((s) => addMonths(s, -1));
  const goNextMonth = () => setViewStart((s) => addMonths(s, 1));
  const goThisMonth = () => setViewStart(TODAY);

  const hasFilters = filterBedrooms || filterProject || filterFrom || filterTo || filterColor || filterUnits.length || filterFloor || filterPriceMin || filterPriceMax || filterAvailable;
  const clearFilters = () => { setFilterBedrooms(''); setFilterProject(''); setFilterFrom(''); setFilterTo(''); setFilterColor(''); setFilterUnits([]); setFilterFloor(''); setFilterPriceMin(''); setFilterPriceMax(''); setFilterAvailable(false); };

  const handlePriceClick = useCallback((unit, dateStr, rangeEnd = null) => {
    if (!canEditSchedulePricing) return;
    const end = rangeEnd || dateStr;
    setPriceCell({
      unitId: unit.id,
      unitName: unit.name,
      dateStr,
      presetFrom: dateStr,
      presetTo: end,
      currentPrice: getUnitDayPrice(unit, dateStr),
      blockSource: blockMap[unit.id]?.[dateStr] || null,
    });
    setPriceModal(true);
  }, [canEditSchedulePricing, priceMap, blockMap]);

  const canBookFromGrid =
    canWriteSchedule ||
    isManualReservations ||
    isWebsiteReservations ||
    isReservationsManager ||
    isAdmin;

  const clearDragPaint = useCallback(() => {
    document.querySelectorAll('td.sched-drag-hit').forEach((el) => {
      el.classList.remove('sched-drag-hit');
    });
    if (dragHintRef.current) dragHintRef.current.hidden = true;
  }, []);

  const paintDragRange = useCallback((unitId, start, end) => {
    const lo = start <= end ? start : end;
    const hi = start <= end ? end : start;
    document.querySelectorAll('td.sched-drag-hit').forEach((el) => {
      el.classList.remove('sched-drag-hit');
    });
    document
      .querySelectorAll(`td[data-sched-unit="${CSS.escape(String(unitId))}"][data-sched-date]`)
      .forEach((td) => {
        const d = td.getAttribute('data-sched-date');
        if (!d) return;
        const span = Number(td.getAttribute('data-sched-span') || 1);
        const cellEnd = span > 1 ? addDays(d, span - 1) : d;
        if (d <= hi && cellEnd >= lo) td.classList.add('sched-drag-hit');
      });
    if (dragHintRef.current) {
      const nights = Math.max(
        1,
        Math.round((new Date(`${hi}T00:00:00`) - new Date(`${lo}T00:00:00`)) / 86400000) + 1
      );
      dragHintRef.current.textContent =
        nights === 1
          ? `${formatDate(lo)} · release to choose`
          : `${formatDate(lo)} → ${formatDate(hi)} · ${nights} nights · release to choose`;
      dragHintRef.current.hidden = false;
    }
  }, []);

  const clearRangeAction = useCallback(() => {
    setRangeAction(null);
    clearDragPaint();
  }, [clearDragPaint]);

  const finishCellGesture = useCallback(() => {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
    }
    const drag = dragSelectRef.current;
    dragSelectRef.current = null;
    document.body.classList.remove('sched-dragging');
    if (!drag?.unitId || !drag.start) {
      clearDragPaint();
      return;
    }

    const start = drag.start <= drag.end ? drag.start : drag.end;
    const end = drag.start <= drag.end ? drag.end : drag.start;

    // Click (no drag) → edit when possible, otherwise single-night reserve
    if (!drag.moved) {
      clearDragPaint();
      if (drag.touch && drag.canEdit && drag.canBook) {
        paintDragRange(drag.unitId, start, end);
        if (dragHintRef.current) dragHintRef.current.hidden = true;
        setRangeAction({ unitId: drag.unitId, unit: drag.unit, start, end, canEdit: true, canBook: true });
        return;
      }
      if (drag.canEdit && drag.unit) {
        handlePriceClick(drag.unit, start);
      } else if (drag.canBook) {
        openCreateDrawer({
          unit_id: String(drag.unitId),
          check_in: start,
          check_out: addDays(end, 1),
        });
      }
      return;
    }

    // Drag → choose edit or reserve
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 250);

    if (drag.canEdit && drag.canBook) {
      paintDragRange(drag.unitId, start, end);
      setRangeAction({
        unitId: drag.unitId,
        unit: drag.unit,
        start,
        end,
        canEdit: true,
        canBook: true,
      });
      if (dragHintRef.current) dragHintRef.current.hidden = true;
      return;
    }

    clearDragPaint();
    if (drag.canBook) {
      openCreateDrawer({
        unit_id: String(drag.unitId),
        check_in: start,
        check_out: addDays(end, 1),
      });
    } else if (drag.canEdit && drag.unit) {
      handlePriceClick(drag.unit, start, end);
    }
  }, [clearDragPaint, handlePriceClick, paintDragRange, isAdmin, user?.id]);

  useEffect(() => {
    const DRAG_THRESHOLD_PX = 6;
    const onMove = (e) => {
      const drag = dragSelectRef.current;
      if (!drag) return;

      // Touch: a swipe scrolls the grid, only a tap selects a night.
      if (drag.touch) {
        const dx = e.clientX - drag.originX;
        const dy = e.clientY - drag.originY;
        if (dx * dx + dy * dy >= 100) dragSelectRef.current = null;
        return;
      }

      if (!drag.moved) {
        const dx = e.clientX - drag.originX;
        const dy = e.clientY - drag.originY;
        const farEnough = dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
        if (!farEnough) {
          // Still check if pointer already entered another day cell
          const peek = document.elementFromPoint(e.clientX, e.clientY);
          const peekTd = peek?.closest?.('td[data-sched-date][data-sched-unit]');
          const peekDate = peekTd?.getAttribute('data-sched-date');
          if (
            !peekTd ||
            peekTd.getAttribute('data-sched-unit') !== String(drag.unitId) ||
            !peekDate ||
            peekDate === drag.start
          ) {
            return;
          }
        }
        if (!drag.canBook && !drag.canEdit) {
          return;
        }
        drag.moved = true;
        document.body.classList.add('sched-dragging');
        paintDragRange(drag.unitId, drag.start, drag.end);
      }

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el?.closest?.('td[data-sched-date][data-sched-unit]');
      if (!td) return;
      if (td.getAttribute('data-sched-unit') !== String(drag.unitId)) return;
      let dateStr = td.getAttribute('data-sched-date');
      const span = Number(td.getAttribute('data-sched-span') || 1);
      if (span > 1 && dateStr) {
        const rect = td.getBoundingClientRect();
        const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
        const offset = Math.min(span - 1, Math.max(0, Math.floor(ratio * span)));
        dateStr = addDays(dateStr, offset);
      }
      if (!dateStr || dateStr < TODAY) return;
      if (drag.end === dateStr) return;
      drag.end = dateStr;
      if (dragRafRef.current) return;
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = 0;
        const cur = dragSelectRef.current;
        if (!cur?.moved) return;
        paintDragRange(cur.unitId, cur.start, cur.end);
      });
    };
    const onUp = () => {
      if (!dragSelectRef.current) return;
      finishCellGesture();
    };
    const onCancel = () => {
      if (!dragSelectRef.current) return;
      if (dragSelectRef.current.touch) {
        dragSelectRef.current = null;
        return;
      }
      finishCellGesture();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current);
    };
  }, [finishCellGesture, paintDragRange, TODAY]);

  const startCellGesture = useCallback(
    (unit, dateStr, event, { canEdit, canBook }) => {
      if (dateStr < TODAY) return;
      if (!canEdit && !canBook) return;
      if (event.button !== 0) return;
      if (event.pointerType === 'touch') {
        dragSelectRef.current = {
          unitId: unit.id,
          unit,
          start: dateStr,
          end: dateStr,
          originX: event.clientX,
          originY: event.clientY,
          moved: false,
          touch: true,
          canEdit: Boolean(canEdit),
          canBook: Boolean(canBook),
        };
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragSelectRef.current = {
        unitId: unit.id,
        unit,
        start: dateStr,
        end: dateStr,
        originX: event.clientX,
        originY: event.clientY,
        moved: false,
        canEdit: Boolean(canEdit),
        canBook: Boolean(canBook),
      };
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    },
    [TODAY]
  );

  const handleResClick = useCallback((res) => {
    if (suppressClickRef.current || dragSelectRef.current) return;
    
    if (res.is_hold || res.status === 'hold') {
      setHoldDetailId(res.id);
      setHoldDetailModal(true);
      return;
    }
    setDetailSeed(res);
    setDetailResId(res.id);
    setDetailModal(true);
  }, []);

  const openEditFromDetail = useCallback(async (res) => {
    try {
      const isHold = !!(res.is_hold || res.status === 'hold');
      setEditForm({
        unit_id: res.unit_id, guest_name: isHold && res.guest_name === 'Hold' ? '' : (res.guest_name || ''),
        guest_email: res.guest_email || '',
        guest_phone: res.guest_phone || '', guest_nationality: res.guest_nationality || '',
        adults: res.adults != null ? String(res.adults) : '2',
        children: res.children != null ? String(res.children) : '0',
        nanny_count: res.nanny_count != null ? String(res.nanny_count) : '0',
        check_in: normDate(res.check_in), check_out: normDate(res.check_out),
        total_amount: isHold ? '' : res.total_amount,
        price_per_night: res.price_per_night || '',
        booking_source: res.booking_source || '', sales_person_id: res.sales_person_id || '',
        is_owner_reservation: !!res.is_owner_reservation,
        
        is_hold: isHold ? false : undefined,
        status: isHold ? 'confirmed' : res.status,
        notes: res.notes || '',
      });
      setEditId(res.id);
      setHoldDetailModal(false); 
      setEditModal(true);
    } catch { toast.error('Failed to load reservation'); }
  }, []);

  const bulkPriceMutation = useMutation({
    mutationFn: async ({ unit_ids, from_date, to_date, price }) => {
      await Promise.all(unit_ids.map(uid =>
        api.post('/daily-prices/batch', { unit_id: uid, from_date, to_date, price })
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries(['daily-prices']);
      setBulkPriceModal(false);
      setBulkMode(false);
      setSelectedUnitIds(new Set());
      toast.success('Price updated for selected units');
    },
    onError: () => toast.error('Failed to update some prices'),
  });

  const canWrite = canWriteSchedule;
  const canEditPrice  = canEditSchedulePricing;

  
  
  const parseUnitCode = (unitNumber = '') => {
    const s = String(unitNumber).trim().toUpperCase();
    if (/^SA/i.test(s)) {
      
      const rest = s.replace(/^SA[-]?/, '');
      const m = rest.match(/^(\d+)([A-Z]?)/);
      return { group: 0, subGroup: 0, floor: m ? parseInt(m[1]) : 0, section: m ? (m[2] || '') : '', raw: s };
    }
    if (/^ST\d/i.test(s)) {
      const m = s.match(/^ST(\d+)/i);
      return { group: 1, subGroup: m ? parseInt(m[1]) : 0, floor: 0, section: '', raw: s };
    }
    if (/^CL\d/i.test(s)) {
      const m = s.match(/^CL(\d+)/i);
      return { group: 2, subGroup: m ? parseInt(m[1]) : 0, floor: 0, section: '', raw: s };
    }
    if (/^F\d/i.test(s)) {
      const m = s.match(/^F(\d+)/i);
      return { group: 3, subGroup: m ? parseInt(m[1]) : 0, floor: 0, section: '', raw: s };
    }
    return { group: 99, subGroup: 0, floor: 0, section: '', raw: s };
  };

  
  const availableFloors = useMemo(() => {
    const floors = new Set();
    (data?.units || []).forEach(u => {
      const f = parseInt(u.floor);
      if (!isNaN(f) && f >= 0) floors.add(f);
    });
    return Array.from(floors).sort((a, b) => a - b);
  }, [data]);

  
  
  
  const sortUnits = (units) => [...units].sort((a, b) => {
    const pA = parseUnitCode(a.unit_number);
    const pB = parseUnitCode(b.unit_number);
    if (pA.group    !== pB.group)    return pA.group    - pB.group;
    if (pA.subGroup !== pB.subGroup) return pA.subGroup - pB.subGroup;
    if (pA.group === 0) { 
      if (pA.floor   !== pB.floor)   return pA.floor    - pB.floor;
      if (pA.section !== pB.section) return pA.section.localeCompare(pB.section);
    }
    return pA.raw.localeCompare(pB.raw, undefined, { numeric: true });
  });

  
  const allReservations = data?.reservations || [];
  const filteredUnits = useMemo(() => {
    const priceMin = filterPriceMin !== '' ? parseFloat(filterPriceMin) : null;
    const priceMax = filterPriceMax !== '' ? parseFloat(filterPriceMax) : null;
    const filtered = (data?.units || []).filter(unit => {
      
      if (filterUnits.length > 0 && !filterUnits.includes(String(unit.id))) return false;

      
      if (filterFloor !== '' && filterFloor !== undefined) {
        if (parseInt(unit.floor) !== parseInt(filterFloor)) return false;
      }

      
      
      if (priceMin !== null || priceMax !== null) {
        const nightly = displayDates
          .map((d) => priceMap[unit.id]?.[isoDate(d)])
          .filter((p) => p != null && p > 0);
        const fallbackPrice = parseFloat(unit.price_per_night) || 0;
        const prices = nightly.length ? nightly : (fallbackPrice > 0 ? [fallbackPrice] : []);
        if (!prices.length) return false;
        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        if (priceMin !== null && highest < priceMin) return false;
        if (priceMax !== null && lowest > priceMax) return false;
      }

      const ur = allReservations.filter(r => r.unit_id === unit.id);
      const lastD  = displayDates[displayDates.length - 1];
      const firstD = displayDates[0];
      if (!lastD || !firstD) return true;
      const last  = isoDate(lastD);
      const first = isoDate(firstD);
      const unitBlocks = blockMap[unit.id] || {};
      const blockedNightsInView = Object.keys(unitBlocks).filter(
        (d) => d >= first && d <= last
      );

      
      if (filterAvailable) {
        const hasOverlap = ur.some(r => normDate(r.check_in) < toStr && normDate(r.check_out) > fromStr);
        if (hasOverlap) return false;
        if (blockedNightsInView.length > 0) return false;
      }

      
      if (!filterColor) return true;
      if (filterColor === 'hold')              return ur.some(r => (r.is_hold || r.status === 'hold') && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'blocked')           return ur.some(r => r.is_owner_reservation && !r.is_hold && parseFloat(r.total_amount) === 0 && normDate(r.check_in) <= last && normDate(r.check_out) > first)
                                                 || blockedNightsInView.some((d) => unitBlocks[d] !== 'reservation');
      if (filterColor === 'owner')             return ur.some(r => r.is_owner_reservation && !r.is_hold && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'sales')             return ur.some(r => !r.is_owner_reservation && !r.is_hold && normDate(r.check_in) <= last && normDate(r.check_out) > first);
      if (filterColor === 'checkout_tomorrow') return ur.some(r => !r.is_hold && normDate(r.check_out) === TOMORROW);
      if (filterColor === 'checkin_tomorrow')  return ur.some(r => !r.is_hold && normDate(r.check_in)  === TOMORROW);
      if (filterColor === 'past')              return ur.some(r => !r.is_hold && normDate(r.check_out) <= TODAY);
      return true;
    });
    return sortUnits(filtered);
  }, [data, filterColor, filterUnits, filterFloor, filterPriceMin, filterPriceMax, filterAvailable, allReservations, displayDates, priceMap, blockMap, fromStr, toStr, TODAY, TOMORROW]);

  
  const unitNameById = useMemo(() => {
    const names = {};
    for (const u of [...unitsList, ...(data?.units || [])]) {
      if (u?.id != null && !names[u.id]) names[u.id] = u.name || u.title || '';
    }
    return names;
  }, [unitsList, data]);

  const monthGroups = useMemo(() => {
    const groups = [];
    for (const d of displayDates) {
      const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.span += 1;
      else groups.push({ label, span: 1 });
    }
    return groups;
  }, [displayDates]);

  const weekendDates = useMemo(
    () => new Set(displayDates.filter((d) => d.getDay() === 5 || d.getDay() === 6).map(isoDate)),
    [displayDates]
  );

  const occupiedNights = useMemo(() => {
    const dates = displayDates.map(isoDate);
    const occ = {};
    for (const r of allReservations) {
      if (String(r.status || '').toLowerCase() === 'cancelled') continue;
      const ci = normDate(r.check_in);
      const co = normDate(r.check_out);
      for (const d of dates) {
        if (d >= ci && d < co) (occ[r.unit_id] ||= new Set()).add(d);
      }
    }
    return occ;
  }, [allReservations, displayDates]);
  const freeCount = (units, d) =>
    units.reduce((n, u) => n + (!occupiedNights[u.id]?.has(d) && !blockMap[u.id]?.[d] ? 1 : 0), 0);

  const guestQuery = guestSearch.trim().toLowerCase();
  const guestDigits = guestQuery.replace(/\D/g, '');
  const matchesGuest = (r) =>
    String(r.guest_name || '').toLowerCase().includes(guestQuery) ||
    (guestDigits.length >= 3 && String(r.guest_phone || '').replace(/\D/g, '').includes(guestDigits));
  const barClassFor = (r) =>
    `${rackBarClass(r, TODAY)}${guestQuery && !matchesGuest(r) ? ' rack-bar--dim' : ''}`;

  const unitGroups = (() => {
    const rows = guestQuery
      ? filteredUnits.filter((u) => allReservations.some((r) => r.unit_id === u.id && matchesGuest(r)))
      : filteredUnits;
    const map = new Map();
    for (const u of rows) {
      const key = u.project || u.compound || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(u);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, units]) => ({ name, units }));
  })();
  const visibleUnitCount = unitGroups.reduce((n, g) => n + g.units.length, 0);
  const toggleGroup = (name) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const rangeLabel =
    filterFrom || filterTo
      ? `${formatDate(fromStr)} — ${filterTo ? formatDate(filterTo) : formatDate(addDays(toStr, -1))}`
      : monthLabel;

  return (
    <div className="rack space-y-1">
      <div className="rack-window">
        <div className="rack-titlebar">
          <CalendarRange className="h-4 w-4 flex-shrink-0" />
          <span>Schedule</span>
          <span className="rack-titlebar-sub">{rangeLabel}</span>
        </div>

        <div className="rack-menubar">
          {canWrite && (
            <>
              <button type="button" onClick={() => openCreateDrawer()} className="rack-btn rack-btn--primary">
                <Plus /> <span className="sm:hidden">New</span>
                <span className="hidden sm:inline">New reservation</span>
              </button>
              <button
                type="button"
                onClick={() => { setHoldPrefill({}); setHoldModal(true); }}
                className="rack-btn"
              >
                <Hourglass /> Hold
              </button>
              <span className="rack-sep" />
            </>
          )}
          <span className="rack-nav order-first sm:order-none">
            <button type="button" onClick={goPrevMonth} className="rack-btn px-2.5" aria-label="Previous month">
              <ChevronLeft />
            </button>
            <span className="rack-field">{monthLabel}</span>
            <button type="button" onClick={goNextMonth} className="rack-btn px-2.5" aria-label="Next month">
              <ChevronRight />
            </button>
            <button type="button" onClick={goThisMonth} className="rack-btn" title="Jump to this month">
              Today
            </button>
          </span>
          <span className="rack-sep" />
          <span className="rack-seg">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSpanMonths(n)}
                aria-pressed={spanMonths === n}
                className="rack-btn"
              >
                {n}
                <span className="sm:hidden">M</span>
                <span className="hidden sm:inline">{n === 1 ? ' Month' : ' Months'}</span>
              </button>
            ))}
          </span>
          {canEditPrice && (
            <>
              <span className="rack-sep" />
              {!bulkMode ? (
                <button
                  type="button"
                  onClick={() => { setBulkMode(true); setSelectedUnitIds(new Set()); }}
                  className="rack-btn"
                >
                  <Edit2 /> Bulk price
                </button>
              ) : (
                <>
                  <span className="px-1 font-bold">{selectedUnitIds.size} selected</span>
                  <button
                    type="button"
                    onClick={() => setSelectedUnitIds(new Set(filteredUnits.map((u) => u.id)))}
                    className="rack-btn"
                  >
                    All
                  </button>
                  <button type="button" onClick={() => setSelectedUnitIds(new Set())} className="rack-btn">
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={selectedUnitIds.size === 0}
                    onClick={() => setBulkPriceModal(true)}
                    className="rack-btn rack-btn--primary"
                  >
                    Apply price
                  </button>
                  <button
                    type="button"
                    onClick={() => { setBulkMode(false); setSelectedUnitIds(new Set()); }}
                    className="rack-btn"
                  >
                    Done
                  </button>
                </>
              )}
            </>
          )}
          <span className="rack-sep rack-mobile-only" />
          <button
            type="button"
            className="rack-btn rack-mobile-only"
            aria-pressed={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Filters{hasFilters ? ' •' : ''}
          </button>
          <span className="rack-sep" />
          <label className="rack-search">
            <Search />
            <input
              type="search"
              value={guestSearch}
              onChange={(e) => setGuestSearch(e.target.value)}
              placeholder="Find guest or phone"
              aria-label="Find guest by name or phone"
            />
          </label>
        </div>

        <fieldset className={`rack-group relative z-40 ${filtersOpen ? '' : 'hidden lg:block'}`}>
          <legend>Filters{hasFilters ? ' (active)' : ''}</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label text-xs">Project</label>
              <SearchableSelect
                className="w-44"
                value={filterProject}
                onChange={(v) => { setFilterProject(v); setFilterUnits([]); }}
                placeholder="All projects"
                options={[{ value: '', label: 'All projects' }, ...projectsList.map((p) => ({ value: p, label: p }))]}
              />
            </div>
            <div>
              <label className="label text-xs">Bedrooms</label>
              <SearchableSelect
                className="w-32"
                value={filterBedrooms}
                onChange={setFilterBedrooms}
                placeholder="All"
                options={[{ value: '', label: 'All' }, ...[0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: n === 0 ? 'Studio' : `${n} BR` }))]}
              />
            </div>
            <div>
              <label className="label text-xs">Floor</label>
              <SearchableSelect
                className="w-28"
                value={filterFloor}
                onChange={setFilterFloor}
                placeholder="All"
                options={[{ value: '', label: 'All' }, ...availableFloors.map((f) => ({ value: String(f), label: f === 0 ? 'Ground' : `Floor ${f}` }))]}
              />
            </div>
            <div>
              <label className="label text-xs">From</label>
              <input type="date" className="input w-38" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input type="date" className="input w-38" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">Min price</label>
              <input type="number" min="0" step="100" className="input w-28" placeholder="Any" value={filterPriceMin} onChange={(e) => setFilterPriceMin(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">Max price</label>
              <input type="number" min="0" step="100" className="input w-28" placeholder="Any" value={filterPriceMax} onChange={(e) => setFilterPriceMax(e.target.value)} />
            </div>
            <div className="relative" ref={unitPickerRef}>
              <label className="label text-xs">Units</label>
              <button
                type="button"
                onClick={() => { setUnitPickerOpen((v) => !v); setUnitPickerSearch(''); }}
                className={`input w-44 flex cursor-pointer items-center justify-between gap-2 text-left ${
                  filterUnits.length > 0 ? 'border-[var(--pms-accent,#2f5d58)] bg-[var(--pms-accent-soft,rgba(47,93,88,0.08))]' : ''
                }`}
              >
                <span className="truncate text-sm">
                  {filterUnits.length === 0 ? 'All units' : `${filterUnits.length} selected`}
                </span>
                <ChevronRight className={`h-3.5 w-3.5 text-ch-muted transition ${unitPickerOpen ? 'rotate-90' : ''}`} />
              </button>
              {unitPickerOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto overscroll-contain rounded-2xl border border-ch-line bg-white shadow-xl">
                  <div className="flex items-center justify-between gap-2 border-b border-ch-line px-3 py-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search units…"
                      value={unitPickerSearch}
                      onChange={(e) => setUnitPickerSearch(e.target.value)}
                      className="flex-1 rounded-lg border border-ch-line px-2 py-1 text-xs outline-none focus:border-[var(--pms-accent,#2f5d58)]"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {filterUnits.length > 0 && (
                      <button onClick={() => setFilterUnits([])} className="whitespace-nowrap text-xs font-semibold text-ch-pine hover:underline">
                        Clear
                      </button>
                    )}
                  </div>
                  {(() => {
                    const q = unitPickerSearch.trim().toLowerCase();
                    const wantProject = filterProject.trim().toLowerCase();
                    const pool = sortUnits(
                      (data?.units || []).filter(
                        (u) =>
                          !wantProject ||
                          String(u.project || u.compound || '').trim().toLowerCase() === wantProject
                      )
                    );
                    const visible = q
                      ? pool.filter((u) => String(unitSelectLabel(u, { withProject: false }) || '').toLowerCase().includes(q) || String(u.name || '').toLowerCase().includes(q) || String(u.unit_number || '').toLowerCase().includes(q))
                      : pool;
                    if (visible.length === 0) {
                      return <p className="px-3 py-4 text-center text-sm text-ch-muted">No units found</p>;
                    }
                    return visible.map((u) => {
                      const isChecked = filterUnits.includes(String(u.id));
                      return (
                        <label
                          key={u.id}
                          className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-slate-50 ${
                            isChecked ? 'bg-[var(--pms-accent-soft,rgba(47,93,88,0.08))]' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() =>
                              setFilterUnits((prev) =>
                                prev.includes(String(u.id))
                                  ? prev.filter((id) => id !== String(u.id))
                                  : [...prev, String(u.id)]
                              )
                            }
                            className="h-4 w-4 flex-shrink-0 rounded border-ch-line accent-[var(--pms-accent,#2f5d58)]"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-ch-pine">{unitDisplay(u)}</div>
                            <div className="text-xs text-ch-muted">
                              {[u.project, u.name && u.unit_number && u.name !== u.unit_number ? u.name : null]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </div>
                          </div>
                        </label>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
            <div className="flex flex-col justify-end">
              <label className="label text-xs opacity-0 select-none">_</label>
              <button
                type="button"
                onClick={() => setFilterAvailable((v) => !v)}
                aria-pressed={filterAvailable}
                className="rack-btn"
              >
                <input type="checkbox" readOnly checked={filterAvailable} className="h-3 w-3" tabIndex={-1} />
                Available only
              </button>
            </div>
            <div>
              <label className="label text-xs">Stay type</label>
              <SearchableSelect
                className="w-48"
                value={filterColor}
                onChange={setFilterColor}
                placeholder="All stays"
                options={COLOR_FILTERS.map((cf) => ({ value: cf.value, label: cf.label }))}
              />
            </div>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="rack-btn self-end">
                <X />
                Clear
              </button>
            )}
          </div>
        </fieldset>

        <div ref={dragHintRef} hidden className="rack-hint sticky top-2 z-20 pointer-events-none m-2" />

        {rangeAction ? (
          <div className="rack-hint rack-action flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              {rangeAction.unit ? `${unitDisplay(rangeAction.unit)} · ` : ''}
              {formatDate(rangeAction.start)}
              {rangeAction.end !== rangeAction.start ? ` → ${formatDate(rangeAction.end)}` : ''}
            </span>
            <span className="flex w-full flex-wrap gap-2 sm:w-auto">
              <button type="button" className="rack-btn" onClick={clearRangeAction}>
                Cancel
              </button>
              {rangeAction.canEdit ? (
                <button
                  type="button"
                  className="rack-btn"
                  onClick={() => {
                    const { unit, start, end } = rangeAction;
                    clearRangeAction();
                    if (unit) handlePriceClick(unit, start, end);
                  }}
                >
                  <DollarSign /> Price / block
                </button>
              ) : null}
              {rangeAction.canBook ? (
                <button
                  type="button"
                  className="rack-btn rack-btn--primary"
                  onClick={() => {
                    const { unitId, start, end } = rangeAction;
                    clearRangeAction();
                    openCreateDrawer({
                      unit_id: String(unitId),
                      check_in: start,
                      check_out: addDays(end, 1),
                    });
                  }}
                >
                  <Plus /> Reserve
                </button>
              ) : null}
            </span>
          </div>
        ) : null}

        {isLoading ? (
          <div className="rack-sheet py-10">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="rack-sheet relative z-0">
            <table
              className="rack-table"
              style={{ width: `calc(var(--rack-head-w) + ${displayDates.length} * var(--rack-cell-w))` }}
            >
              <colgroup>
                <col style={{ width: 'var(--rack-head-w)' }} />
                {displayDates.map((d) => (
                  <col key={isoDate(d)} style={{ width: CELL_W }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-30">
                <tr className="rack-month">
                  <th rowSpan={2} className="rack-rowhead sticky left-0 z-40 align-bottom">
                    <div className="rack-rowhead-inner" style={{ height: 62 }}>
                      <span className="rack-col-code">Unit</span>
                      <span className="rack-col-name">Name</span>
                      <span className="rack-col-br">BR</span>
                    </div>
                  </th>
                  {monthGroups.map((g) => (
                    <th key={g.label} colSpan={g.span}>
                      <span className="sticky inline-block left-[116px] sm:left-[260px]">{g.label}</span>
                    </th>
                  ))}
                </tr>
                <tr>
                  {displayDates.map((d) => {
                    const dStr = isoDate(d);
                    const cls =
                      dStr === TODAY ? 'rack-today-head' : weekendDates.has(dStr) ? 'rack-weekend' : '';
                    return (
                      <th
                        key={dStr}
                        style={{ minWidth: CELL_W, width: CELL_W }}
                        className={`rack-day ${cls}`}
                        title={formatDate(dStr)}
                      >
                        {d.getDate()}
                        <span className="rack-dow">
                          {d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}
                        </span>
                      </th>
                    );
                  })}
                </tr>
                <tr className="rack-avail">
                  <th className="rack-rowhead sticky left-0 z-40">
                    <div className="rack-rowhead-inner">
                      <span className="rack-col-code">Free units</span>
                    </div>
                  </th>
                  {displayDates.map((d) => {
                    const dStr = isoDate(d);
                    const free = freeCount(filteredUnits, dStr);
                    const total = filteredUnits.length;
                    const occPct = total ? Math.round(((total - free) / total) * 100) : 0;
                    return (
                      <th
                        key={dStr}
                        className={free === 0 && total ? 'rack-free--full' : ''}
                        title={`${formatDate(dStr)} · ${free} of ${total} free · ${occPct}% occupied`}
                      >
                        {free}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {unitGroups.map((g) => [
                  <tr key={`grp-${g.name}`} className="rack-group-row">
                    <td className="rack-rowhead sticky left-0 z-10">
                      <button type="button" className="rack-group-toggle" onClick={() => toggleGroup(g.name)}>
                        <ChevronRight className={collapsedGroups.has(g.name) ? '' : 'rotate-90'} />
                        <span className="truncate">{g.name}</span>
                        <span className="rack-group-count">{g.units.length}</span>
                      </button>
                    </td>
                    {displayDates.map((d) => {
                      const dStr = isoDate(d);
                      const free = freeCount(g.units, dStr);
                      return (
                        <td
                          key={dStr}
                          className={`rack-free ${free === 0 ? 'rack-free--full' : ''}`}
                          title={`${g.name} · ${formatDate(dStr)} · ${free} of ${g.units.length} free`}
                        >
                          {free}
                        </td>
                      );
                    })}
                  </tr>,
                  ...(collapsedGroups.has(g.name) ? [] : g.units).map((unit) => {
                  const cells = buildRow(unit.id, displayDates, allReservations);
                  const name = unit.name || unit.title || '';
                  return (
                    <tr key={unit.id}>
                      <td className="rack-rowhead sticky left-0 z-10">
                        <div
                          className="rack-rowhead-inner"
                          title={[unitDisplay(unit), name, unit.project].filter(Boolean).join(' · ')}
                        >
                          <span className="rack-col-code">
                            <span className="rack-code">
                            {bulkMode && (
                              <input
                                type="checkbox"
                                checked={selectedUnitIds.has(unit.id)}
                                onChange={(e) =>
                                  setSelectedUnitIds((prev) => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(unit.id) : next.delete(unit.id);
                                    return next;
                                  })
                                }
                                className="h-4 w-4 flex-shrink-0 accent-[#217346]"
                              />
                            )}
                              <span className="truncate">{unitDisplay(unit)}</span>
                            </span>
                            {name && <span className="rack-subname">{name}</span>}
                          </span>
                          <span className="rack-col-name gap-1">
                            <span>{name || unit.project || '—'}</span>
                            {unit.photos_link && (
                              <a
                                href={unit.photos_link}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-auto flex-shrink-0 text-[#185c37]"
                                title="View photos"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </span>
                          <span className="rack-col-br">
                            {unit.bedrooms > 0 ? unit.bedrooms : 'S'}
                          </span>
                        </div>
                      </td>

                      {cells.map((cell, j) => {
                        if (cell.type === 'price') {
                          const price = getUnitDayPrice(unit, cell.date);
                          const blockSrc = blockMap[unit.id]?.[cell.date];
                          const otaLook = otaBlockLook(blockSrc);
                          const isToday = cell.date === TODAY;
                          const isPast = cell.date < TODAY;
                          const isPriced = price != null && price > 0;
                          const isLongTermUnit = unit.listing_type === 'long_term';
                          const hasCheckinTomorrow =
                            cell.date === TODAY &&
                            allReservations.some(
                              (r) => r.unit_id === unit.id && normDate(r.check_in) === TOMORROW
                            );
                          const hatch = otaLook
                            ? otaLook.hatch
                            : blockSrc
                              ? 'repeating-linear-gradient(135deg, rgba(0,0,0,0.12) 0 3px, transparent 3px 6px)'
                              : undefined;
                          let cellCls = 'rack-cell';
                          if (otaLook) cellCls += ` ${otaLook.cellBg} ${otaLook.ringClass}`;
                          else if (blockSrc) cellCls += ' rack-cell--blocked';
                          else if (isPast) cellCls += ' rack-cell--past';
                          else if (hasCheckinTomorrow) cellCls += ' rack-cell--arrival-tomorrow';
                          else if (isPriced) cellCls += weekendDates.has(cell.date) ? ' rack-cell--weekend' : '';
                          else if (isLongTermUnit) cellCls += ' rack-cell--lt';
                          else cellCls += ' rack-cell--unpriced';
                          if (isToday) cellCls += ' rack-cell--today';
                          const canEditCell = canEditPrice && !isPast;
                          const canBookCell =
                            canBookFromGrid &&
                            (!isLongTermUnit || canReserveLongTermUnits) &&
                            !isPast &&
                            !blockSrc &&
                            !otaLook;
                          const cellClickable = canEditCell || canBookCell;
                          if (cellClickable) cellCls += ' rack-cell--clickable';
                          return (
                            <td
                              key={j}
                              data-sched-unit={unit.id}
                              data-sched-date={cell.date}
                              data-sched-bookable={canBookCell ? '1' : '0'}
                              style={{
                                minWidth: CELL_W,
                                width: CELL_W,
                                ...(hatch ? { backgroundImage: hatch } : {}),
                                userSelect: 'none',
                              }}
                              className={cellCls}
                              onPointerDown={(e) => {
                                startCellGesture(unit, cell.date, e, {
                                  canEdit: canEditCell,
                                  canBook: canBookCell,
                                });
                              }}
                              title={
                                canEditCell && canBookCell
                                  ? `Click to edit · Drag to choose Edit or Reserve · ${formatDate(cell.date)}`
                                  : canBookCell
                                    ? `Drag to book · ${formatDate(cell.date)}`
                                    : canEditCell
                                      ? `Click or drag to edit · ${formatDate(cell.date)}`
                                      : blockSrc
                                        ? `${
                                          otaLook
                                            ? otaLook.label
                                            : blockSrc === 'owner'
                                              ? 'Owner'
                                              : blockSrc === 'reservation' || blockSrc === 'booking'
                                                ? 'Reservation'
                                                : 'Admin'
                                        } · ${formatDate(cell.date)}`
                                        : isPriced
                                          ? `${currency(price)} · ${formatDate(cell.date)}`
                                          : isLongTermUnit
                                            ? `Long-term${unit.price_monthly > 0 ? ` · ${currency(unit.price_monthly)} / month` : ''} · ${formatDate(cell.date)}`
                                            : `No price — guests see unavailable · ${formatDate(cell.date)}`
                              }
                            >
                              {otaLook ? (
                                <span className={`px-0.5 text-[8px] font-black tracking-widest ${otaLook.badgeClass}`}>
                                  {otaLook.badge}
                                </span>
                              ) : blockSrc && !isPriced ? (
                                <span className="font-bold">BLK</span>
                              ) : isPriced ? (
                                shortPrice(price)
                              ) : isLongTermUnit ? (
                                'LT'
                              ) : null}
                            </td>
                          );
                        }

                        if (cell.type === 'turnover') {
                          const outCls = barClassFor(cell.outRes);
                          const inCls = barClassFor(cell.inRes);
                          return (
                            <td
                              key={j}
                              data-sched-unit={unit.id}
                              data-sched-date={cell.date}
                              style={{ minWidth: CELL_W, width: CELL_W }}
                              className="rack-cell"
                            >
                              <div className="rack-split">
                                <div
                                  className={`rack-bar rack-bar--end w-1/2 ${outCls}`}
                                  title={rackTip(cell.outRes)}
                                  onClick={() => handleResClick(cell.outRes)}
                                />
                                <div
                                  className={`rack-bar rack-bar--start w-1/2 ${inCls}`}
                                  title={rackTip(cell.inRes)}
                                  onClick={() => handleResClick(cell.inRes)}
                                />
                              </div>
                            </td>
                          );
                        }

                        const barCls = barClassFor(cell.res);
                        const tipText = rackTip(cell.res);

                        if (cell.type === 'checkin' || cell.type === 'checkout') {
                          const openPrice = getUnitDayPrice(unit, cell.date);
                          const isPastOpen = cell.date < TODAY;
                          const openHalf = (
                            <div
                              className={`rack-half ${canEditPrice && !isPastOpen ? 'cursor-cell' : ''} ${
                                isPastOpen ? 'text-[#a8a8a8]' : ''
                              }`}
                              title={
                                cell.type === 'checkin'
                                  ? `Open morning — previous guest can check out · ${formatDate(cell.date)}`
                                  : `Open for next check-in · ${formatDate(cell.date)}`
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (canEditPrice && !isPastOpen) handlePriceClick(unit, cell.date);
                              }}
                            >
                              {openPrice != null && openPrice > 0 ? shortPrice(openPrice) : ''}
                            </div>
                          );
                          const barHalf = (
                            <div
                              className={`rack-bar w-1/2 ${
                                cell.type === 'checkin' ? 'rack-bar--start' : 'rack-bar--end'
                              } ${barCls}`}
                              title={tipText}
                              onClick={() => handleResClick(cell.res)}
                            />
                          );
                          return (
                            <td
                              key={j}
                              data-sched-unit={unit.id}
                              data-sched-date={cell.date}
                              style={{ minWidth: CELL_W, width: CELL_W }}
                              className={`rack-cell ${cell.date === TODAY ? 'rack-cell--today' : ''}`}
                            >
                              <div className="rack-split">
                                {cell.type === 'checkin' ? (
                                  <>
                                    {openHalf}
                                    {barHalf}
                                  </>
                                ) : (
                                  <>
                                    {barHalf}
                                    {openHalf}
                                  </>
                                )}
                              </div>
                            </td>
                          );
                        }

                        if (cell.type === 'mid') {
                          return (
                            <td
                              key={j}
                              data-sched-unit={unit.id}
                              data-sched-date={cell.date}
                              data-sched-span={cell.span}
                              colSpan={cell.span}
                              style={{ minWidth: `calc(${CELL_W} * ${cell.span})` }}
                              className="rack-cell"
                            >
                              <div
                                className={`rack-bar ${barCls}`}
                                title={tipText}
                                onClick={() => handleResClick(cell.res)}
                              >
                                <span className="rack-bar-name">{cell.res.guest_name}</span>
                                {cell.span > 3 && (
                                  <span className="rack-bar-extra max-w-[72px] truncate">
                                    {cell.res.is_owner_reservation ? 'Owner' : cell.res.sales_person_name || ''}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        }

                        return null;
                      })}
                    </tr>
                  );
                }),
                ])}
                {visibleUnitCount === 0 && (
                  <tr>
                    <td colSpan={displayDates.length + 1} className="px-6 py-16 text-center">
                      <p className="font-bold">
                        {(data?.units || []).length === 0
                          ? 'No units yet'
                          : guestQuery
                            ? `No guest matching “${guestSearch.trim()}” in these dates`
                            : 'No matching units'}
                      </p>
                      <p className="mt-1 text-[#555]">
                        {(data?.units || []).length === 0
                          ? 'Add units in the Units page to start scheduling.'
                          : 'Try clearing filters or widening the date range.'}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="rack-statusbar">
          <span>{filteredUnits.length} units</span>
          {RACK_LEGEND.map((item) => (
            <span key={item.label}>
              <i className={`rack-swatch ${item.cls}`} />
              {item.label}
            </span>
          ))}
          {[
            { badge: 'AB', className: 'bg-[#FF5A5F] text-white', label: 'Airbnb outside' },
            { badge: 'BK', className: 'bg-[#003580] text-white', label: 'Booking.com outside' },
          ].map((item) => (
            <span key={item.badge}>
              <b className={`px-0.5 text-[8px] tracking-widest ${item.className}`}>{item.badge}</b>
              {item.label}
            </span>
          ))}
          <span className="ml-auto hidden md:inline-flex">
            {canEditPrice && canBookFromGrid
              ? 'Click a night to edit · Drag for Edit or Reserve'
              : canBookFromGrid
                ? 'Drag across open nights to reserve'
                : canEditPrice
                  ? 'Click or drag nights to edit prices'
                  : 'Click a reservation to see it'}
          </span>
        </div>
      </div>

      
      <PriceEditorModal
        open={priceModal}
        onClose={() => setPriceModal(false)}
        unitId={priceCell?.unitId}
        unitName={priceCell?.unitName}
        dateStr={priceCell?.dateStr}
        presetFrom={priceCell?.presetFrom}
        presetTo={priceCell?.presetTo}
        currentPrice={priceCell?.currentPrice}
        blockSource={priceCell?.blockSource}
        saving={priceMutation.isPending || blockMutation.isPending}
        onSave={(unitId, from, to, price) => priceMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, price })}
        onClear={(unitId, from, to) => priceMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, clear: true })}
        onBlock={(unitId, from, to) => blockMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, clear: false })}
        onUnblock={(unitId, from, to) => blockMutation.mutate({ unit_id: unitId, from_date: from, to_date: to, clear: true })}
      />

      <ReservationDetailModal
        open={detailModal}
        onClose={() => {
          setDetailModal(false);
          setDetailSeed(null);
        }}
        reservationId={detailResId}
        seed={detailSeed}
        unitName={unitNameById[detailSeed?.unit_id]}
        canWrite={canWrite}
        cancelling={cancelReservationMutation.isPending}
        deleting={deleteReservationMutation.isPending}
        onMoveUnit={(res) => {
          setTransferRes(res);
          setDetailModal(false);
        }}
        onEdit={(res) => {
          openEditFromDetail(res);
          setDetailModal(false);
        }}
        onCancel={(res) => {
          setCancelConfirmId(res.id);
        }}
        onDelete={(res) => setDeleteConfirmId(res.id)}
      />

      <ConfirmDialog
        open={!!cancelConfirmId}
        onClose={() => setCancelConfirmId(null)}
        onConfirm={() =>
          cancelReservationMutation.mutate({
            id: cancelConfirmId,
            reason: 'Cancelled from schedule',
          })
        }
        loading={cancelReservationMutation.isPending}
        title="Cancel reservation?"
        message="This marks the reservation as cancelled and frees the calendar nights."
        confirmText="Cancel reservation"
        danger
      />

      <ConfirmDialog
        open={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteReservationMutation.mutate(deleteConfirmId)}
        loading={deleteReservationMutation.isPending}
        title="Delete reservation?"
        message="Permanently delete this reservation from the system. This cannot be undone."
        confirmText="Delete"
        danger
      />

      <TransferReservationModal
        open={!!transferRes}
        reservation={transferRes}
        units={unitsList}
        onClose={() => setTransferRes(null)}
        onTransferred={() => {
          qc.invalidateQueries({ queryKey: ['schedule'] });
          qc.invalidateQueries({ queryKey: ['reservations'] });
          qc.invalidateQueries({ queryKey: ['reservation-detail'] });
        }}
      />

      <EditReservationModal
        open={editModal}
        onClose={() => setEditModal(false)}
        editId={editId}
        editForm={editForm}
        setEditForm={setEditForm}
        unitsList={bookableUnitsList}
        usersList={salesUsers}
        saving={editMutation.isPending}
        onSave={() => editMutation.mutate()}
      />

      <HoldModal
        open={holdModal}
        onClose={() => setHoldModal(false)}
        prefillUnit={holdPrefill.unitId}
        prefillCheckIn={holdPrefill.checkIn}
        prefillCheckOut={holdPrefill.checkOut}
        unitsList={bookableUnitsList}
        saving={holdMutation.isPending}
        onSave={(data) => holdMutation.mutate(data)}
      />

      <BulkPriceModal
        open={bulkPriceModal}
        onClose={() => setBulkPriceModal(false)}
        unitCount={selectedUnitIds.size}
        saving={bulkPriceMutation.isPending}
        onSave={(from, to, price) => bulkPriceMutation.mutate({ unit_ids: [...selectedUnitIds], from_date: from, to_date: to, price })}
      />

      <HoldDetailModal
        open={holdDetailModal}
        onClose={() => setHoldDetailModal(false)}
        holdId={holdDetailId}
        onConfirm={(hold) => openEditFromDetail(hold)}
        onDelete={(id) => deleteHoldMutation.mutate(id)}
        deleting={deleteHoldMutation.isPending}
      />

      <AdminReservationDrawer
        open={createDrawer}
        onClose={() => { setCreateDrawer(false); setCreateProof(null); }}
      >
        <ManualReservationForm
          form={createForm}
          setForm={setCreateForm}
          units={unitsList}
          users={salesUsers}
          transferProof={createProof}
          onTransferProofChange={setCreateProof}
          lockSalesPerson={!isAdmin}
          currentUserName={user?.full_name || user?.username || ''}
          allowPastDates={isAdmin}
          onCancel={() => { setCreateDrawer(false); setCreateProof(null); }}
          onSubmit={handleCreateReservation}
          submitting={createReservationMutation.isPending}
        />
      </AdminReservationDrawer>
    </div>
  );
}
