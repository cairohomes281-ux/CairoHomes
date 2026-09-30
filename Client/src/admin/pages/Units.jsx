import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Building2, BedDouble, Bath, Layers, Eye, ExternalLink, DollarSign, Globe, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SortTh from '../components/ui/SortTh';
import { currency, UNIT_TYPES, normalizePropertyType, unitDisplay } from '../utils/formatters';
import SearchableSelect from '../components/ui/SearchableSelect';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import { normalizeProjectName } from '../../utils/projectNames';
import TagSelect from '../components/ui/TagSelect';
import ConfirmDialog from '../components/ui/ConfirmDialog';

function guestListingPath(unit) {
  const slug = String(unit?.slug || '').trim();
  return slug ? `/listings/${encodeURIComponent(slug)}` : null;
}

const COMMISSION_MODES = [
  { value: 'A', label: 'Fixed Rate', desc: 'Commission = nightly rate × % (all bookings)' },
  { value: 'B', label: 'Split Rate', desc: 'Nightly rate × owner % + nightly rate × tenant %' },
  { value: 'C', label: 'Source-Based', desc: 'Nightly rate × via-us/via-owner % (+ tenant %)' },
];

const VIEW_OPTIONS = [
  'Nile view',
  'City view',
  'Pyramids view',
  'Garden view',
  'Pool view',
  'Street view',
  'Courtyard view',
  'Back view',
];


const AMENITY_SUGGESTIONS = [
  'Wi-Fi',
  'Bed linens',
  'Cooking basics',
  'Free parking',
  'Heating',
  'Stove',
  'Microwave',
  'Kettle',
  'Refrigerator',
  'Air conditioning',
  'Smart TV',
  'Washer',
  'Dryer',
  'Dishwasher',
  'Oven',
  'Coffee maker',
  'Toaster',
  'Blender',
  'Dining table',
  'Private balcony',
  'Private terrace',
  'Blackout curtains',
  'Extra pillows and blankets',
  'Hangers',
  'Iron',
  'Hair dryer',
  'Shampoo',
  'Body soap',
  'Hot water',
  'Bathtub',
  'Shower',
  'Bidet',
  'Dedicated workspace',
  'Safe',
  'Elevator access',
  'Ground-floor access',
  'Keyless smart lock',
  'Self check-in',
  'Kitchenette',
  'Full kitchen',
  'Outdoor dining area',
  'BBQ grill',
  'Private pool access',
  'Housekeeping available',
];

const FLOOR_OPTIONS = [
  { value: 0, label: 'Ground' },
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: 5, label: '5th' },
  { value: 6, label: '6th' },
  { value: 7, label: '7th' },
  { value: 8, label: '8th' },
  { value: 9, label: '9th' },
  { value: 10, label: '10th' },
  { value: 11, label: '11th' },
  { value: 12, label: '12th' },
  { value: 13, label: '13th' },
  { value: 14, label: '14th' },
  { value: 15, label: '15th' },
];

const EMPTY_FORM = {
  name: '', destination: '', project: '', unit_number: '', type: 'Apartment',
  bedrooms: 1, bathrooms: 1, floor: 0, guests: 2, has_nanny_room: false,
  disable_automatic_reservations: false,
  owner_name: '', owner_email: '', owner_phone: '',
  commission_mode: 'A',
  company_commission_pct: 20,
  company_commission_owner_pct: 10,
  commission_tenant_pct: 0,
  photo_urls: [],
  photos_folder_url: '',
  cover_drive_url: '',
  cover_url: '',
  price_per_night: '',
  price_monthly: '',
  min_nights: '',
  utilities_cost: '',
  ops_status: 'available',
  listing_status: 'published',
  view: '',
  description: '',
  amenities: [],
  location_link: '',
  unit_area: '',
};


function guestsFromBedrooms(bedrooms, hasNannyRoom = false) {
  const n = Number(bedrooms);
  if (!Number.isFinite(n) || n <= 0) return 2;
  const base = Math.round(n) * 2;
  return hasNannyRoom ? base + 1 : base;
}

function toTagList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function CommissionSection({ form, setForm }) {
  const mode = form.commission_mode;
  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-4">
      <div>
        <label className="label">Commission Structure</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
          {COMMISSION_MODES.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => setForm(f => ({ ...f, commission_mode: m.value }))}
              className={`text-left px-3 py-2.5 rounded-lg border-2 transition-colors ${
                mode === m.value
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className={`text-xs font-bold ${mode === m.value ? 'text-primary-700' : 'text-gray-700'}`}>
                Mode {m.value} — {m.label}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="form-grid">
        {mode === 'A' && (
          <div>
            <label className="label">Commission % (All Bookings)</label>
            <input type="number" min="0" max="100" step="0.5" className="input"
              value={form.company_commission_pct}
              onChange={e => setForm(f => ({ ...f, company_commission_pct: e.target.value }))} />
          </div>
        )}

        {mode === 'B' && (
          <>
            <div>
              <label className="label">Owner Commission %</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.company_commission_pct}
                onChange={e => setForm(f => ({ ...f, company_commission_pct: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tenant Commission %</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.commission_tenant_pct}
                onChange={e => setForm(f => ({ ...f, commission_tenant_pct: e.target.value }))} />
            </div>
          </>
        )}

        {mode === 'C' && (
          <>
            <div>
              <label className="label">Owner Commission % — Via Us</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.company_commission_pct}
                onChange={e => setForm(f => ({ ...f, company_commission_pct: e.target.value }))} />
            </div>
            <div>
              <label className="label">Owner Commission % — Via Owner</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.company_commission_owner_pct}
                onChange={e => setForm(f => ({ ...f, company_commission_owner_pct: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tenant Commission %</label>
              <input type="number" min="0" max="100" step="0.5" className="input"
                value={form.commission_tenant_pct}
                onChange={e => setForm(f => ({ ...f, commission_tenant_pct: e.target.value }))} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UnitForm({ form, setForm, listingType = 'rent' }) {
  const { isAdmin, canManageUnits } = usePermissions();
  const canSeeOwner = isAdmin || canManageUnits;
  const isLongTerm = listingType === 'long_term';
  const { destinations, projectsByDestination } = useProjectCatalog();
  const projectOptions = projectsByDestination[form.destination] || [];

  function applyProjectChange(project) {
    setForm((f) => ({
      ...f,
      project,
      compound: project,
    }));
  }

  return (
    <div className="space-y-4">
      <div className="form-grid">
        <div><label className="label">Unit Name *</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Marina Heights A101" /></div>
        <div>
          <label className="label">Destination *</label>
          <select
            className="input"
            value={form.destination || ''}
            onChange={(e) => setForm((f) => ({
              ...f,
              destination: e.target.value,
              area: e.target.value,
              project: '',
            }))}
          >
            <option value="">Select destination…</option>
            {destinations.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
            {form.destination && !destinations.includes(form.destination) && (
              <option value={form.destination}>{form.destination}</option>
            )}
          </select>
        </div>
        <div>
          <label className="label">Project *</label>
          <select
            className="input"
            value={form.project || ''}
            onChange={(e) => applyProjectChange(e.target.value)}
            disabled={!form.destination}
          >
            <option value="">{form.destination ? 'Select project…' : 'Pick destination first'}</option>
            {projectOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            {form.project && !projectOptions.includes(form.project) && (
              <option value={form.project}>{form.project}</option>
            )}
          </select>
        </div>
        <div><label className="label">Unit Number *</label><input className="input" value={form.unit_number} onChange={e => setForm(f => ({ ...f, unit_number: e.target.value.toUpperCase() }))} placeholder="e.g. A101" /></div>
        <div>
          <label className="label">Type *</label>
          <SearchableSelect value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))}
            placeholder="Select type…"
            options={UNIT_TYPES.map(t => ({ value: t, label: t }))}
          />
        </div>
        <div>
          <label className="label">View</label>
          <select className="input" value={form.view || ''} onChange={e => setForm(f => ({ ...f, view: e.target.value }))}>
            <option value="">Select view…</option>
            {VIEW_OPTIONS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Bedrooms</label>
          <input
            type="number"
            min="0"
            className="input"
            value={form.bedrooms}
            onChange={(e) => {
              const bedrooms = e.target.value;
              setForm((f) => ({
                ...f,
                bedrooms,
                guests: guestsFromBedrooms(bedrooms, f.has_nanny_room),
              }));
            }}
          />
        </div>
        <div><label className="label">Bathrooms</label><input type="number" min="0" className="input" value={form.bathrooms} onChange={e => setForm(f => ({ ...f, bathrooms: e.target.value }))} /></div>
        <div>
          <label className="label">Floor</label>
          <select
            className="input"
            value={FLOOR_OPTIONS.some((o) => String(o.value) === String(form.floor)) ? form.floor : 0}
            onChange={(e) => setForm((f) => ({ ...f, floor: Number(e.target.value) }))}
          >
            {FLOOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <input
            id="has_nanny_room"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600"
            checked={!!form.has_nanny_room}
            onChange={(e) => {
              const has_nanny_room = e.target.checked;
              setForm((f) => ({
                ...f,
                has_nanny_room,
                guests: guestsFromBedrooms(f.bedrooms, has_nanny_room),
              }));
            }}
          />
          <div>
            <label htmlFor="has_nanny_room" className="text-sm font-medium text-gray-800">
              Nanny room
            </label>
            <p className="text-xs text-gray-500">
              Optional. Capacity becomes (bedrooms × 2) + 1. Nannies are not charged beach access.
            </p>
          </div>
        </div>
        {!isLongTerm ? (
          <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
            <input
              id="disable_automatic_reservations"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600"
              checked={!!form.disable_automatic_reservations}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  disable_automatic_reservations: e.target.checked,
                }))
              }
            />
            <div>
              <label
                htmlFor="disable_automatic_reservations"
                className="text-sm font-medium text-gray-800"
              >
                Disable automatic reservations
              </label>
              <p className="text-xs text-gray-500">
                Guests cannot book this unit online. The listing shows a WhatsApp Inquiry button
                instead of Reserve.
              </p>
            </div>
          </div>
        ) : null}
        <div>
          <label className="label">Guests / capacity</label>
          <input
            type="number"
            className="input bg-gray-50"
            value={guestsFromBedrooms(form.bedrooms, form.has_nanny_room)}
            readOnly
          />
          <p className="text-xs text-gray-400 mt-1">
            Auto: {form.has_nanny_room ? '2 × bedrooms + 1 nanny' : '2 × bedrooms'} (studio = 2)
          </p>
        </div>
        {isLongTerm ? (
          <>
            <div>
              <label className="label">Monthly rent (EGP) *</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={form.price_monthly}
                onChange={(e) => setForm((f) => ({ ...f, price_monthly: e.target.value }))}
                placeholder="e.g. 45000"
              />
            </div>
            <div>
              <label className="label">Minimum stay (nights) *</label>
              <input
                type="number"
                min="1"
                step="1"
                className="input"
                value={form.min_nights}
                onChange={(e) => setForm((f) => ({ ...f, min_nights: e.target.value }))}
                placeholder="e.g. 30"
              />
              <p className="text-xs text-gray-400 mt-1">
                Set on this unit only — the project minimum stay does not apply.
              </p>
            </div>
            <div>
              <label className="label">Area (m²)</label>
              <input
                type="number"
                min="1"
                step="1"
                className="input"
                value={form.unit_area}
                onChange={(e) => setForm((f) => ({ ...f, unit_area: e.target.value }))}
                placeholder="e.g. 145"
              />
            </div>
            <div>
              <label className="label">Utilities Cost Per Night (EGP)</label>
              <input type="number" min="0" step="0.01" className="input" value={form.utilities_cost} onChange={e => setForm(f => ({ ...f, utilities_cost: e.target.value }))} placeholder="Optional" />
            </div>
            <p className="sm:col-span-2 text-xs text-gray-500">
              Guests can see available dates and send a WhatsApp inquiry, but cannot book this unit
              online. Reservations are made from the Schedule or Reservations page.
            </p>
          </>
        ) : (
          <>
            <div>
              <label className="label">Fallback nightly (EGP)</label>
              <input type="number" min="0" step="0.01" className="input" value={form.price_per_night} onChange={e => setForm(f => ({ ...f, price_per_night: e.target.value }))} placeholder="Display price per night" />
            </div>
            <div>
              <label className="label">Utilities Cost Per Night (EGP)</label>
              <input type="number" min="0" step="0.01" className="input" value={form.utilities_cost} onChange={e => setForm(f => ({ ...f, utilities_cost: e.target.value }))} placeholder="0.00" />
            </div>
            <p className="sm:col-span-2 text-xs text-gray-500">
              Beach access is set on the project (Destinations &amp; Projects), not per unit.
            </p>
          </>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-700">Guest listing</h4>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="The property…" />
        </div>
        <div className="form-grid">
          <TagSelect
            label="Amenities"
            placeholder="Select or type amenities…"
            suggestions={AMENITY_SUGGESTIONS}
            selectedTags={form.amenities || []}
            onTagsChange={(tags) => setForm((f) => ({ ...f, amenities: tags }))}
          />
          <p className="sm:col-span-2 text-xs text-gray-400 -mt-2">
            Compound facilities are managed on Destinations → project (shared by all units in that project).
          </p>
          <div className="sm:col-span-2">
            <label className="label">Location / maps link</label>
            <input type="url" className="input" value={form.location_link} onChange={e => setForm(f => ({ ...f, location_link: e.target.value }))} placeholder="https://maps.google.com/…" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Cover photo (Google Drive file)</label>
            <input
              type="url"
              className="input"
              value={form.cover_drive_url || ''}
              onChange={(e) => setForm((f) => ({ ...f, cover_drive_url: e.target.value }))}
              placeholder="https://drive.google.com/file/d/…"
            />
            <p className="text-xs text-gray-400 mt-1">
              Paste a link to a single image file (not a folder). Must be shared as “Anyone with the link”.
              This is the main photo shown on listing cards and at the top of the unit page.
            </p>
            {(form.cover_url || form.cover_drive_url) && (
              <div className="mt-3 flex items-start gap-3">
                {form.cover_url ? (
                  <a
                    href={form.cover_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block h-20 w-28 overflow-hidden rounded-lg border border-gray-200 bg-slate-50"
                  >
                    <img
                      src={form.cover_url}
                      alt="Cover preview"
                      className="h-full w-full object-cover"
                    />
                  </a>
                ) : (
                  <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-slate-50 text-[11px] text-gray-400 text-center px-2">
                    Preview after save
                  </div>
                )}
                <p className="text-xs text-emerald-700 pt-1">
                  {form.cover_url ? 'Current cover photo' : 'Cover will apply when you save'}
                </p>
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="label">Google Drive folder (photos)</label>
            <input
              type="url"
              className="input"
              value={form.photos_folder_url || ''}
              onChange={(e) => setForm((f) => ({ ...f, photos_folder_url: e.target.value }))}
              placeholder="https://drive.google.com/drive/folders/…"
            />
            <p className="text-xs text-gray-400 mt-1">
              Folder must be shared as “Anyone with the link”. On save we load all images inside into the listing gallery.
              If no cover file is set, the first folder image is used as the cover.
            </p>
            {!!form.photo_urls?.length && (
              <p className="text-xs text-emerald-700 mt-1">{form.photo_urls.length} photo{form.photo_urls.length === 1 ? '' : 's'} currently linked</p>
            )}
          </div>
        </div>
      </div>

      {canSeeOwner && (
        <div className="border-t border-gray-100 pt-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Owner Details</h4>
          <div className="form-grid">
            <div><label className="label">Owner Name</label><input className="input" value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} /></div>
            <div><label className="label">Owner Email</label><input type="email" className="input" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} /></div>
            <div><label className="label">Owner Phone</label><input className="input" value={form.owner_phone} onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))} /></div>
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Commission Structure</h4>
        <CommissionSection form={form} setForm={setForm} />
      </div>

      <div className="border-t border-gray-100 pt-4">
        <div className="form-grid">
          <div>
            <label className="label">Ops status</label>
            <SearchableSelect value={form.ops_status} onChange={v => setForm(f => ({ ...f, ops_status: v }))}
              options={[{ value: 'available', label: 'Available' }, { value: 'occupied', label: 'Occupied' }, { value: 'maintenance', label: 'Maintenance' }]}
            />
          </div>
          <div>
            <label className="label">Listing status</label>
            <div className="input bg-gray-50 text-sm text-gray-700 flex items-center">
              Auto — published when every field is filled, otherwise draft
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Status is set automatically. Missing required fields keeps the unit as draft and hidden from guests. Beach access is configured on the project.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommissionBadge({ unit }) {
  const mode = unit.commission_mode || 'A';
  if (mode === 'A') return <span className="text-xs text-gray-500">Fixed: <strong className="text-gray-700">{unit.company_commission_pct}%</strong></span>;
  if (mode === 'B') return <span className="text-xs text-gray-500">Owner: <strong className="text-gray-700">{unit.company_commission_pct}%</strong> · Tenant: <strong className="text-gray-700">{unit.commission_tenant_pct || 0}%</strong></span>;
  return <span className="text-xs text-gray-500">Via Us: <strong className="text-gray-700">{unit.company_commission_pct}%</strong> · Via Owner: <strong className="text-gray-700">{unit.company_commission_owner_pct || 10}%</strong> · Tenant: <strong className="text-gray-700">{unit.commission_tenant_pct || 0}%</strong></span>;
}

export default function Units({ listingType = 'rent' }) {
  const qc = useQueryClient();
  const { canDeleteUnits, canManageUnits, canManageLongTermUnits } = usePermissions();
  const { destinations: catalogDestinations, projectsByDestination, projectNames: catalogProjects } =
    useProjectCatalog();
  const isLongTerm = listingType === 'long_term';
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterOpsStatus, setFilterOpsStatus] = useState('');
  const [filterDestination, setFilterDestination] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterBedrooms, setFilterBedrooms] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [deleteWithReservations, setDeleteWithReservations] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [handoffUnit, setHandoffUnit] = useState(null);
  const [unpublishTarget, setUnpublishTarget] = useState(null);

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['units', listingType, search, filterStatus, filterOpsStatus, filterDestination, filterProject, filterBedrooms],
    queryFn: () => api.get('/units', {
      params: {
        listing_type: listingType,
        search: search || undefined,
        status: filterStatus || undefined,
        ops_status: filterOpsStatus || undefined,
        destination: filterDestination || undefined,
        project: filterProject || undefined,
        bedrooms: filterBedrooms || undefined,
      },
    }).then(r => r.data),
  });

  const projectFilterOptions = useMemo(() => {
    if (filterDestination) {
      return [...(projectsByDestination[filterDestination] || [])].sort((a, b) =>
        a.localeCompare(b)
      );
    }
    return catalogProjects;
  }, [catalogProjects, filterDestination, projectsByDestination]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const res = editId
        ? await api.put(`/units/${editId}`, data)
        : await api.post('/units', data);
      return res.data;
    },
    onSuccess: (unit) => {
      qc.invalidateQueries({ queryKey: ['units'] });
      qc.invalidateQueries({ queryKey: ['unit-projects'] });
      qc.invalidateQueries({ queryKey: ['guest-projects-catalog'] });
      const n = unit?.photo_urls?.length || 0;
      const missing = unit?.listing_completeness?.missing || [];
      if (unit?.status === 'draft' && missing.length) {
        toast.success(
          `Saved as draft (hidden from guests). Missing: ${missing.join(', ')}`
        );
        if (unit?.id) setHandoffUnit(unit);
      } else if (unit?.status === 'published') {
        toast.success(
          editId
            ? (n ? `Unit published · ${n} photos from Drive` : 'Unit published')
            : (n ? `Unit created & published · ${n} photos from Drive` : 'Unit created & published')
        );
        setHandoffUnit(null);
      } else {
        toast.success(
          editId
            ? (n ? `Unit updated · ${n} photos from Drive` : 'Unit updated')
            : (n ? `Unit created · ${n} photos from Drive` : 'Unit created as draft')
        );
        if (unit?.id && unit.status === 'draft') setHandoffUnit(unit);
      }
      setModal(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving unit'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, delete_reservations }) =>
      api.delete(`/units/${id}`, { data: { delete_reservations: !!delete_reservations } }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['units'] });
      toast.success(
        vars.delete_reservations
          ? 'Unit and its reservations deleted'
          : 'Unit deleted'
      );
      setDeleteId(null);
      setDeleteWithReservations(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting unit'),
  });

  const unpublishMutation = useMutation({
    mutationFn: (id) => api.patch(`/units/${id}/unpublish`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['units'] });
      toast.success(`${res.data?.name || res.data?.title || 'Unit'} unpublished — hidden from guests`);
      setUnpublishTarget(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error unpublishing unit'),
  });

  const publishMutation = useMutation({
    mutationFn: (id) => api.patch(`/units/${id}/publish`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['units'] });
      const missing = res.data?.listing_completeness?.missing || [];
      if (res.data?.status === 'published') {
        toast.success(`${res.data?.name || res.data?.title || 'Unit'} published`);
      } else if (missing.length) {
        toast.error(`Still draft — missing: ${missing.join(', ')}`);
      } else {
        toast.success(`${res.data?.name || res.data?.title || 'Unit'} updated`);
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error publishing unit'),
  });

  const openDelete = (unit) => {
    setDeleteId(unit.id);
    setDeleteWithReservations(false);
  };

  const openAdd = () => {
    setForm({
      ...EMPTY_FORM,
      amenities: [],
      photo_urls: [],
    });
    setEditId(null);
    setModal('add');
  };
  const openEdit = (u) => {
    setEditId(u.id);
    setForm({
      ...EMPTY_FORM,
      name: u.name || u.title || '',
      destination: u.destination || u.area || '',
      project: u.project || u.compound || '',
      unit_number: u.unit_number || '',
      type: normalizePropertyType(u.type || u.property_type || 'Apartment'),
      bedrooms: u.bedrooms ?? u.beds ?? 1,
      bathrooms: u.bathrooms ?? u.baths ?? 1,
      floor: u.floor ?? 0,
      has_nanny_room: !!u.has_nanny_room,
      disable_automatic_reservations: !!u.disable_automatic_reservations,
      guests: guestsFromBedrooms(u.bedrooms ?? u.beds ?? 1, !!u.has_nanny_room),
      owner_name: u.owner_name || '',
      owner_email: u.owner_email || '',
      owner_phone: u.owner_phone || '',
      commission_mode: u.commission_mode || 'A',
      company_commission_pct: u.company_commission_pct ?? 20,
      company_commission_owner_pct: u.company_commission_owner_pct ?? 10,
      commission_tenant_pct: u.commission_tenant_pct ?? 0,
      description: u.description || u.the_property || '',
      amenities: toTagList(u.amenities),
      location_link: u.location_link || u.source_url || '',
      photos_folder_url: u.photos_folder_url || '',
      cover_drive_url: u.cover_drive_url || '',
      cover_url: u.cover_url || '',
      photo_urls: Array.isArray(u.photo_urls) ? u.photo_urls : [],
      price_per_night: u.price_per_night ?? u.price_fallback ?? '',
      price_monthly: u.price_monthly ?? '',
      min_nights: u.min_nights ?? '',
      utilities_cost: u.utilities_cost ?? '',
      unit_area: u.unit_area ?? u.size_m2 ?? '',
      ops_status: u.ops_status || 'available',
      view: u.view || '',
      listing_status: u.status || 'published',
    });
    setModal('edit');
  };
  const handleSave = () => {
    if (!String(form.name || '').trim()) {
      toast.error('Unit name is required');
      return;
    }
    if (!String(form.destination || '').trim()) {
      toast.error('Destination is required');
      return;
    }
    if (!String(form.project || '').trim()) {
      toast.error('Project is required');
      return;
    }
    if (isLongTerm && !(Number(form.min_nights) >= 1)) {
      toast.error('Minimum stay (nights) is required for long-term units');
      return;
    }
    const projectName = normalizeProjectName(form.project);

    saveMutation.mutate({
      listing_type: listingType,
      title: form.name,
      name: form.name,
      destination: form.destination,
      area: form.destination,
      project: projectName,
      compound: projectName,
      projectName,
      unit_number: form.unit_number,
      ops_status: form.ops_status,
      property_type: normalizePropertyType(form.type),
      type: normalizePropertyType(form.type),
      bedrooms: form.bedrooms,
      beds: form.bedrooms,
      bathrooms: form.bathrooms,
      baths: form.bathrooms,
      floor: form.floor,
      view: form.view,
      has_nanny_room: !!form.has_nanny_room,
      disable_automatic_reservations: !!form.disable_automatic_reservations,
      guests: guestsFromBedrooms(form.bedrooms, form.has_nanny_room),
      capacity: guestsFromBedrooms(form.bedrooms, form.has_nanny_room),
      owner_name: form.owner_name,
      owner_email: form.owner_email,
      owner_phone: form.owner_phone,
      commission_mode: form.commission_mode,
      company_commission_pct: form.company_commission_pct,
      company_commission_owner_pct: form.company_commission_owner_pct,
      commission_tenant_pct: form.commission_tenant_pct,
      the_property: form.description,
      description: form.description,
      amenities: form.amenities,
      location_link: form.location_link,
      source_url: form.location_link,
      photos_folder_url: form.photos_folder_url || '',
      cover_drive_url: form.cover_drive_url || '',
      cover_url: form.cover_url || '',
      unit_area: form.unit_area || null,
      size_m2: form.unit_area || null,
      price_per_night: isLongTerm ? null : (form.price_per_night === '' ? null : form.price_per_night),
      ...(isLongTerm
        ? {
            price_monthly_egp: form.price_monthly === '' ? null : form.price_monthly,
            min_nights: form.min_nights,
          }
        : {}),
      utilities_cost: form.utilities_cost === '' ? null : form.utilities_cost,
    });
  };
  const canWrite = isLongTerm ? canManageLongTermUnits : canManageUnits;
  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(units, 'name', 'asc');

  return (
    <div className="space-y-6">
      {handoffUnit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>{handoffUnit.name || handoffUnit.title}</strong> saved as draft
            {handoffUnit.listing_completeness?.missing?.length
              ? ` (missing: ${handoffUnit.listing_completeness.missing.join(', ')})`
              : ''}. Complete the listing, then it can appear to guests.
          </span>
          <div className="flex gap-2">
            <button type="button" className="text-xs underline" onClick={() => setHandoffUnit(null)}>Dismiss</button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">{isLongTerm ? 'Units (Long Term)' : 'Units (Short Term)'}</h1>
          <p className="page-subtitle">
            {units.length} unit{units.length !== 1 ? 's' : ''}
            {isLongTerm ? ' for long-term rent · inquiry only on the website' : ' for short-term rent'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button onClick={() => setViewMode('grid')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Grid</button>
            <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Table</button>
          </div>
          {canWrite && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />Add Unit</button>}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            { value: '', label: 'All' },
            { value: 'published', label: 'Published' },
            { value: 'unpublished', label: 'Unpublished' },
            { value: 'draft', label: 'Draft' },
          ].map((chip) => {
            const active = filterStatus === chip.value;
            return (
              <button
                key={chip.value || 'all'}
                type="button"
                onClick={() => setFilterStatus(chip.value)}
                className={`inline-block flex-none rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  active
                    ? 'border-ch-pine bg-ch-pine-50 text-ch-pine'
                    : 'border-ch-line bg-white text-ch-pine hover:border-ch-pine'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search units, projects, owners...">
        <SearchableSelect className="w-40" value={filterOpsStatus} onChange={setFilterOpsStatus}
          placeholder="Ops status"
          options={[
            { value: '', label: 'All ops status' },
            { value: 'available', label: 'Ops: Available' },
            { value: 'occupied', label: 'Ops: Occupied' },
            { value: 'maintenance', label: 'Ops: Maintenance' },
          ]}
        />
        <SearchableSelect
          className="w-44"
          value={filterDestination}
          onChange={(v) => {
            setFilterDestination(v);
            setFilterProject('');
          }}
          placeholder="All Destinations"
          options={[
            { value: '', label: 'All Destinations' },
            ...catalogDestinations.map((d) => ({ value: d, label: d })),
          ]}
        />
        <SearchableSelect className="w-44" value={filterProject} onChange={setFilterProject}
          placeholder="All Projects"
          options={[{ value: '', label: 'All Projects' }, ...projectFilterOptions.map(p => ({ value: p, label: p }))]}
        />
        <SearchableSelect className="w-36" value={filterBedrooms} onChange={setFilterBedrooms}
          placeholder="All Bedrooms"
          options={[{ value: '', label: 'All Bedrooms' }, ...[0,1,2,3,4,5,6].map(n => ({ value: String(n), label: n === 0 ? 'Studio' : `${n} BR` }))]}
        />
      </SearchFilter>

      {isLoading ? <LoadingSpinner /> : units.length === 0 ? (
        <EmptyState icon={Building2} title="No units found" subtitle="Add your first unit to get started"
          action={canWrite && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />Add Unit</button>} />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {units.map(u => (
            <div key={u.id} className="card hover:shadow-md transition-shadow p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-lg font-bold tracking-tight text-gray-900">
                    {unitDisplay(u, '—')}
                  </p>
                  {(u.name || u.title) && (
                    <p className="mt-0.5 text-xs font-normal text-gray-400 truncate max-w-[16rem]">
                      {u.name || u.title}
                    </p>
                  )}
                  <p className="text-sm text-gray-500">{u.project}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge status={u.status} />
                  {u.ops_status && <span className="text-[10px] uppercase text-gray-400">{u.ops_status}</span>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm text-gray-600 mb-3">
                <div className="flex items-center gap-1.5"><BedDouble className="w-4 h-4 text-gray-400" />{u.bedrooms ?? u.beds} bed</div>
                <div className="flex items-center gap-1.5"><Bath className="w-4 h-4 text-gray-400" />{u.bathrooms ?? u.baths} bath</div>
                <div className="flex items-center gap-1.5"><Layers className="w-4 h-4 text-gray-400" />{parseInt(u.floor) === 0 ? 'Ground' : `Floor ${u.floor}`}</div>
              </div>
              {u.view && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600 font-medium mb-2">
                  <Eye className="w-3.5 h-3.5" />{u.view}
                </div>
              )}
              {(isLongTerm
                ? u.price_monthly > 0
                : (u.price_per_night > 0 || u.price_fallback > 0)) && (
                <div className="flex items-center gap-1.5 text-sm text-emerald-700 font-medium mb-2">
                  <DollarSign className="w-4 h-4" />
                  {isLongTerm
                    ? <>{currency(u.price_monthly)} / month</>
                    : <>{currency(u.price_per_night || u.price_fallback)} / night</>}
                </div>
              )}
              {isLongTerm && u.min_nights > 0 && (
                <p className="text-xs text-gray-500 mb-2">Min stay: {u.min_nights} nights</p>
              )}
              <div className="flex items-center justify-between pt-3 border-t border-gray-100 gap-2">
                <CommissionBadge unit={u} />
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {guestListingPath(u) ? (
                    <a
                      href={guestListingPath(u)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-ch-line bg-white px-2 py-1 text-[11px] font-semibold text-ch-pine hover:border-ch-pine hover:bg-ch-pine-50 transition-colors"
                      title="Open guest listing page"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Guest page
                    </a>
                  ) : null}
                  {(u.cover_url || u.photo_urls?.[0]) && (
                    <a href={u.cover_url || u.photo_urls[0]} target="_blank" rel="noreferrer"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="View Photos">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  {canWrite && u.status === 'published' && (
                    <button
                      type="button"
                      onClick={() => setUnpublishTarget(u)}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                      title="Unpublish — hide from guest website"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      Unpublish
                    </button>
                  )}
                  {canWrite && u.listing_unpublished && (
                    <button
                      type="button"
                      onClick={() => publishMutation.mutate(u.id)}
                      disabled={publishMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                      title="Publish — show on guest website"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Publish
                    </button>
                  )}
                  {canWrite && <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"><Edit2 className="w-4 h-4" /></button>}
                  {canDeleteUnits && <button onClick={() => openDelete(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="unit_number" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Code</SortTh>
                  <SortTh col="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Unit</SortTh>
                  <SortTh col="project" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Project</SortTh>
                  <SortTh col="type" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Type</SortTh>
                  <th>Beds/Bath</th>
                  <SortTh col={isLongTerm ? 'price_monthly' : 'price_per_night'} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    {isLongTerm ? 'Price/Month' : 'Price/Night'}
                  </SortTh>
                  {isLongTerm && (
                    <SortTh col="min_nights" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Min stay</SortTh>
                  )}
                  <SortTh col="owner_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Owner</SortTh>
                  <th>Commission</th><th>Photos</th>
                  <SortTh col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Status</SortTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(u => (
                  <tr key={u.id}>
                    <td className="font-semibold text-gray-800 whitespace-nowrap">{unitDisplay(u, '—')}</td>
                    <td className="text-gray-500">{u.name || u.title || '—'}</td>
                    <td>{u.project}</td>
                    <td>{u.type || u.property_type}</td>
                    <td>{u.bedrooms ?? u.beds}B/{u.bathrooms ?? u.baths}Ba</td>
                    <td>
                      {isLongTerm
                        ? (u.price_monthly > 0 ? currency(u.price_monthly) : '—')
                        : ((u.price_per_night || u.price_fallback) > 0 ? currency(u.price_per_night || u.price_fallback) : '—')}
                    </td>
                    {isLongTerm && <td>{u.min_nights ? `${u.min_nights} nights` : '—'}</td>}
                    <td>{u.owner_name || '—'}</td>
                    <td><CommissionBadge unit={u} /></td>
                    <td>
                      {(u.cover_url || u.photo_urls?.[0])
                        ? <a href={u.cover_url || u.photo_urls[0]} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline text-xs flex items-center gap-1"><ExternalLink className="w-3 h-3" />View</a>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td><Badge status={u.status} /></td>
                    <td>
                        <div className="flex gap-1 items-center">
                          {guestListingPath(u) ? (
                            <a
                              href={guestListingPath(u)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-gray-200 px-1.5 py-1 text-[11px] font-semibold text-ch-pine hover:bg-ch-pine-50"
                              title="Open guest listing page"
                            >
                              <Globe className="w-3.5 h-3.5" />
                              Guest
                            </a>
                          ) : null}
                          {canWrite && u.status === 'published' && (
                            <button
                              type="button"
                              onClick={() => setUnpublishTarget(u)}
                              className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                              title="Unpublish — hide from guest website"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                              Unpublish
                            </button>
                          )}
                          {canWrite && u.listing_unpublished && (
                            <button
                              type="button"
                              onClick={() => publishMutation.mutate(u.id)}
                              disabled={publishMutation.isPending}
                              className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                              title="Publish — show on guest website"
                            >
                              <Globe className="w-3.5 h-3.5" />
                              Publish
                            </button>
                          )}
                          {canWrite && (
                            <button onClick={() => openEdit(u)} className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"><Edit2 className="w-3.5 h-3.5" /></button>
                          )}
                          {canDeleteUnits && <button onClick={() => openDelete(u)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modal === 'add' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={modal === 'edit'
          ? (isLongTerm ? 'Edit Long-Term Unit' : 'Edit Unit')
          : (isLongTerm ? 'Add Long-Term Unit' : 'Add New Unit')}
        size="lg"
        footer={<>
          <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !form.name || !form.destination || !form.project || (isLongTerm && !form.min_nights)}
            className="btn-primary"
          >
            {saveMutation.isPending ? 'Saving...' : modal === 'edit' ? 'Save Changes' : 'Create draft'}
          </button>
        </>}
      >
        <UnitForm form={form} setForm={setForm} listingType={listingType} />
      </Modal>

      <Modal
        open={!!deleteId}
        onClose={() => {
          if (deleteMutation.isPending) return;
          setDeleteId(null);
          setDeleteWithReservations(false);
        }}
        title="Delete Unit"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={deleteMutation.isPending}
              onClick={() => {
                setDeleteId(null);
                setDeleteWithReservations(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteMutation.mutate({
                  id: deleteId,
                  delete_reservations: deleteWithReservations,
                })
              }
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Permanently delete this unit? This cannot be undone.
          </p>
          <div className="space-y-2">
            <label className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 cursor-pointer hover:border-ch-pine">
              <input
                type="radio"
                className="mt-1"
                name="delete_unit_mode"
                checked={!deleteWithReservations}
                onChange={() => setDeleteWithReservations(false)}
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900">Unit only</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Keep all reservations. Delete is blocked if this unit still has any.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/50 px-3 py-2.5 cursor-pointer hover:border-red-400">
              <input
                type="radio"
                className="mt-1"
                name="delete_unit_mode"
                checked={deleteWithReservations}
                onChange={() => setDeleteWithReservations(true)}
              />
              <span>
                <span className="block text-sm font-semibold text-red-800">
                  Unit and all its reservations
                </span>
                <span className="block text-xs text-red-700/80 mt-0.5">
                  Also permanently deletes payments and commissions linked to those stays.
                </span>
              </span>
            </label>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!unpublishTarget}
        onClose={() => {
          if (unpublishMutation.isPending) return;
          setUnpublishTarget(null);
        }}
        onConfirm={() => unpublishMutation.mutate(unpublishTarget.id)}
        title="Unpublish unit"
        message={
          unpublishTarget
            ? `Hide ${unitDisplay(unpublishTarget, 'this unit')} from the guest website? The listing stays in admin as draft until you publish it again.`
            : ''
        }
        confirmText="Unpublish"
        danger
        loading={unpublishMutation.isPending}
      />
    </div>
  );
}
