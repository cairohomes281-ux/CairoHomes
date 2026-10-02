import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Building2, BedDouble, Bath, Users, Eye, ExternalLink, DollarSign, Globe, EyeOff } from 'lucide-react';
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
import ConfirmDialog from '../components/ui/ConfirmDialog';

function guestListingPath(unit) {
  const slug = String(unit?.slug || '').trim();
  return slug ? `/listings/${encodeURIComponent(slug)}` : null;
}

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


const EMPTY_FORM = {
  unit_number: '',
  name: '',
  price_per_night: '',
  price_monthly: '',
  location_link: '',
  photos_folder_url: '',
  cover_drive_url: '',
  cover_url: '',
  photo_urls: [],
  description: '',
  bedrooms: 1,
  bathrooms: 1,
  view: '',
  destination: '',
  project: '',
  type: 'Apartment',
  guests: 2,
};

function guestsFromBedrooms(bedrooms) {
  const n = Number(bedrooms);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.round(n) * 2;
}

function UnitForm({ form, setForm, listingType = 'rent' }) {
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
        <div>
          <label className="label">Internal name *</label>
          <input className="input" value={form.unit_number} onChange={e => setForm(f => ({ ...f, unit_number: e.target.value.toUpperCase() }))} placeholder="e.g. ZAM-A101" />
          <p className="text-xs text-gray-400 mt-1">For staff only — guests never see this.</p>
        </div>
        <div><label className="label">Unit name *</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Nile View Apartment" /></div>
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
        <div>
          <label className="label">Unit type *</label>
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
          <label className="label">Number of bedrooms *</label>
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
                guests: guestsFromBedrooms(bedrooms),
              }));
            }}
          />
        </div>
        <div><label className="label">Number of bathrooms *</label><input type="number" min="0" className="input" value={form.bathrooms} onChange={e => setForm(f => ({ ...f, bathrooms: e.target.value }))} /></div>
        <div>
          <label className="label">Number of guests *</label>
          <input
            type="number"
            min="1"
            className="input"
            value={form.guests}
            onChange={(e) => setForm((f) => ({ ...f, guests: e.target.value }))}
          />
        </div>
        {isLongTerm ? (
          <div>
            <label className="label">Price per month (EGP) *</label>
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
        ) : (
          <div>
            <label className="label">Price per night (EGP) *</label>
            <input type="number" min="0" step="1" className="input" value={form.price_per_night} onChange={e => setForm(f => ({ ...f, price_per_night: e.target.value }))} placeholder="e.g. 3500" />
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div>
          <label className="label">Description *</label>
          <textarea className="input resize-none" rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="The property…" />
        </div>
        <div className="form-grid">
          <div className="sm:col-span-2">
            <label className="label">Location (Google Maps link) *</label>
            <input type="url" className="input" value={form.location_link} onChange={e => setForm(f => ({ ...f, location_link: e.target.value }))} placeholder="https://maps.google.com/…" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Cover photo link (optional)</label>
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
            <label className="label">Google Drive link (photos) *</label>
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
        <p className="text-xs text-gray-400">
          The unit is published automatically once every required field (*) is filled; otherwise it stays a hidden draft.
        </p>
      </div>
    </div>
  );
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
      photo_urls: [],
    });
    setEditId(null);
    setModal('add');
  };
  const openEdit = (u) => {
    setEditId(u.id);
    const bedrooms = u.bedrooms ?? u.beds ?? 1;
    setForm({
      ...EMPTY_FORM,
      unit_number: u.unit_number || '',
      name: u.name || u.title || '',
      destination: u.destination || u.area || '',
      project: u.project || u.compound || '',
      type: normalizePropertyType(u.type || u.property_type || 'Apartment'),
      bedrooms,
      bathrooms: u.bathrooms ?? u.baths ?? 1,
      guests: u.guests ?? u.capacity ?? guestsFromBedrooms(bedrooms),
      view: u.view || '',
      description: u.description || u.the_property || '',
      location_link: u.location_link || u.source_url || '',
      photos_folder_url: u.photos_folder_url || '',
      cover_drive_url: u.cover_drive_url || '',
      cover_url: u.cover_url || '',
      photo_urls: Array.isArray(u.photo_urls) ? u.photo_urls : [],
      price_per_night: u.price_per_night ?? u.price_fallback ?? '',
      price_monthly: u.price_monthly ?? '',
    });
    setModal('edit');
  };
  const handleSave = () => {
    if (!String(form.unit_number || '').trim()) {
      toast.error('Internal name is required');
      return;
    }
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
    if (!(Number(form.guests) >= 1)) {
      toast.error('Number of guests must be at least 1');
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
      property_type: normalizePropertyType(form.type),
      type: normalizePropertyType(form.type),
      bedrooms: form.bedrooms,
      beds: form.bedrooms,
      bathrooms: form.bathrooms,
      baths: form.bathrooms,
      view: form.view,
      guests: Number(form.guests),
      capacity: Number(form.guests),
      the_property: form.description,
      description: form.description,
      location_link: form.location_link,
      source_url: form.location_link,
      photos_folder_url: form.photos_folder_url || '',
      cover_drive_url: form.cover_drive_url || '',
      cover_url: form.cover_url || '',
      price_per_night: isLongTerm ? null : (form.price_per_night === '' ? null : form.price_per_night),
      ...(isLongTerm
        ? { price_monthly_egp: form.price_monthly === '' ? null : form.price_monthly }
        : {}),
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
                <div className="flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" />{u.guests ?? u.capacity ?? '—'} guests</div>
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
              <div className="flex items-center justify-end pt-3 border-t border-gray-100 gap-2">
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
                  <SortTh col="guests" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Guests</SortTh>
                  <th>Photos</th>
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
                    <td>{u.guests ?? u.capacity ?? '—'}</td>
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
            disabled={saveMutation.isPending || !form.unit_number || !form.name || !form.destination || !form.project}
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
