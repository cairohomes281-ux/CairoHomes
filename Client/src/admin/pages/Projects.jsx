import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ImagePlus, MapPin, Pencil, Plus, Trash2, Upload, Waves } from 'lucide-react';

import { PROJECT_CATALOG_KEY } from '../../hooks/useProjectCatalog';
import TagSelect from '../components/ui/TagSelect';
import { FACILITY_SUGGESTIONS } from '../utils/facilitySuggestions';

const BEACH_MODES = [
  { value: 'per_guest', label: 'Per guest' },
  { value: 'flat', label: 'Flat per stay' },
  { value: 'free', label: 'Free' },
  { value: 'tiered', label: 'Stay-length tiers' },
];

const BEACH_PERIODS = [
  { value: 1, label: 'Every 1 day' },
  { value: 3, label: 'Every 3 days' },
  { value: 7, label: 'Every 7 days' },
  { value: 14, label: 'Every 14 days' },
];

const EMPTY_BEACH = {
  beach_access_enabled: false,
  beach_access_mode: 'per_guest',
  beach_access_adult_egp: '',
  beach_access_extra_egp: '',
  beach_access_days: 7,
  beach_access_flat_egp: '',
  beach_access_flat_studio_egp: '',
};

function beachFromRow(row) {
  if (!row?.beach_access_enabled) return { ...EMPTY_BEACH };
  return {
    beach_access_enabled: true,
    beach_access_mode: row.beach_access_mode || 'per_guest',
    beach_access_adult_egp: row.beach_access_adult_egp ?? '',
    beach_access_extra_egp: row.beach_access_extra_egp ?? '',
    beach_access_days: Number(row.beach_access_days) || 7,
    beach_access_flat_egp: row.beach_access_flat_egp ?? '',
    beach_access_flat_studio_egp: row.beach_access_flat_studio_egp ?? '',
  };
}

function appendBeachFields(fd, beach) {
  fd.append('beach_access_enabled', beach.beach_access_enabled ? 'true' : 'false');
  if (!beach.beach_access_enabled) return;
  fd.append('beach_access_mode', beach.beach_access_mode || 'per_guest');
  fd.append('beach_access_days', String(beach.beach_access_days || 7));
  if (beach.beach_access_mode === 'per_guest') {
    if (beach.beach_access_adult_egp !== '' && beach.beach_access_adult_egp != null) {
      fd.append('beach_access_adult_egp', String(beach.beach_access_adult_egp));
    }
    if (beach.beach_access_extra_egp !== '' && beach.beach_access_extra_egp != null) {
      fd.append('beach_access_extra_egp', String(beach.beach_access_extra_egp));
    }
  }
  if (beach.beach_access_mode === 'flat') {
    if (beach.beach_access_flat_egp !== '' && beach.beach_access_flat_egp != null) {
      fd.append('beach_access_flat_egp', String(beach.beach_access_flat_egp));
    }
    if (beach.beach_access_flat_studio_egp !== '' && beach.beach_access_flat_studio_egp != null) {
      fd.append('beach_access_flat_studio_egp', String(beach.beach_access_flat_studio_egp));
    }
  }
}

function beachSummary(row) {
  if (!row?.beach_access_enabled) return null;
  const mode = row.beach_access_mode || 'per_guest';
  if (mode === 'free') return 'Free club access';
  if (mode === 'tiered') return 'Stay-length tiered rates';
  if (mode === 'flat') {
    const flat = Number(row.beach_access_flat_egp) || 0;
    const studio = Number(row.beach_access_flat_studio_egp) || flat;
    return `Flat stay: ${flat.toLocaleString('en-US')} EGP (studio ${studio.toLocaleString('en-US')})`;
  }
  const adult = Number(row.beach_access_adult_egp) || 0;
  const extra = Number(row.beach_access_extra_egp) || 0;
  const days = Number(row.beach_access_days) || 7;
  return `Per guest: ${adult.toLocaleString('en-US')} EGP` +
    (extra > 0 ? ` · extra ${extra.toLocaleString('en-US')}` : '') +
    ` / ${days} day${days === 1 ? '' : 's'}`;
}

function BeachAccessEditor({ beach, setBeach }) {
  if (!beach.beach_access_enabled) {
    return (
      <div className="md:col-span-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => setBeach((b) => ({ ...b, beach_access_enabled: true }))}
        >
          <Plus className="h-3.5 w-3.5" /> Add club access
        </button>
        <p className="mt-1.5 text-xs text-gray-500">
          Optional. Applies to every unit in this project.
        </p>
      </div>
    );
  }

  const mode = beach.beach_access_mode || 'per_guest';
  return (
    <div className="md:col-span-2 space-y-3 rounded-xl border border-sky-100 bg-sky-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-sky-950 inline-flex items-center gap-2">
          <Waves className="h-4 w-4" /> Club access
        </p>
        <button
          type="button"
          className="text-xs font-medium text-red-600 hover:underline"
          onClick={() => setBeach({ ...EMPTY_BEACH })}
        >
          Remove club access
        </button>
      </div>
      <div className="form-grid">
        <div>
          <label className="label">Pricing mode</label>
          <select
            className="input"
            value={mode}
            onChange={(e) => setBeach((b) => ({ ...b, beach_access_mode: e.target.value }))}
          >
            {BEACH_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        {mode !== 'tiered' && mode !== 'free' ? (
          <div>
            <label className="label">Access period</label>
            <select
              className="input"
              value={beach.beach_access_days || 7}
              onChange={(e) => setBeach((b) => ({ ...b, beach_access_days: Number(e.target.value) }))}
            >
              {BEACH_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        ) : null}
        {mode === 'per_guest' ? (
          <>
            <div>
              <label className="label">Adult / guest (EGP)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={beach.beach_access_adult_egp}
                onChange={(e) => setBeach((b) => ({ ...b, beach_access_adult_egp: e.target.value }))}
                placeholder="Per person / period"
              />
            </div>
            <div>
              <label className="label">Extra guest (EGP)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={beach.beach_access_extra_egp}
                onChange={(e) => setBeach((b) => ({ ...b, beach_access_extra_egp: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </>
        ) : null}
        {mode === 'flat' ? (
          <>
            <div>
              <label className="label">Flat fee (EGP)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={beach.beach_access_flat_egp}
                onChange={(e) => setBeach((b) => ({ ...b, beach_access_flat_egp: e.target.value }))}
                placeholder="Non-studio units"
              />
            </div>
            <div>
              <label className="label">Studio flat fee (EGP)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={beach.beach_access_flat_studio_egp}
                onChange={(e) => setBeach((b) => ({ ...b, beach_access_flat_studio_egp: e.target.value }))}
                placeholder="Studios"
              />
            </div>
          </>
        ) : null}
        {mode === 'tiered' ? (
          <p className="sm:col-span-2 text-xs text-sky-900">
            Automatic by stay length: 3 nights → 1,900 / extra 2,500 · 4 nights → 2,500 / extra 3,100 ·
            5+ nights → 3,500 / extra 4,100.
          </p>
        ) : null}
        {mode === 'free' ? (
          <p className="sm:col-span-2 text-xs text-sky-900">
            No beach fees are charged for units in this project.
          </p>
        ) : null}
      </div>
    </div>
  );
}

async function catalogFetch(path, options = {}) {
  const token = localStorage.getItem('pms_token');
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json.data || json;
}

export default function Projects() {
  const qc = useQueryClient();
  const createFileRef = useRef(null);
  const editFileRef = useRef(null);

  const { data: catalog, isLoading: loadingCatalog, refetch } = useQuery({
    queryKey: PROJECT_CATALOG_KEY,
    queryFn: () => catalogFetch('/projects/catalog'),
  });

  const destinations = catalog?.destinations || [];
  const projectsByDestination = catalog?.projectsByDestination || {};
  const items = catalog?.items || [];

  const [selectedDestination, setSelectedDestination] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [projectNameInput, setProjectNameInput] = useState('');
  const [createFacilities, setCreateFacilities] = useState([]);
  const [createMinNights, setCreateMinNights] = useState(2);
  const [createBeach, setCreateBeach] = useState({ ...EMPTY_BEACH });
  const [createImageFile, setCreateImageFile] = useState(null);
  const [createImagePreview, setCreateImagePreview] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editFacilities, setEditFacilities] = useState([]);
  const [editMinNights, setEditMinNights] = useState(2);
  const [editBeach, setEditBeach] = useState({ ...EMPTY_BEACH });
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState('');
  const [editingDestination, setEditingDestination] = useState(false);
  const [destinationEditName, setDestinationEditName] = useState('');

  useEffect(() => {
    if (!selectedDestination && destinations[0]) {
      setSelectedDestination(destinations[0]);
      return;
    }
    if (selectedDestination && destinations.length && !destinations.includes(selectedDestination)) {
      setSelectedDestination(destinations[0] || '');
    }
  }, [destinations, selectedDestination]);

  useEffect(() => {
    return () => {
      if (createImagePreview) URL.revokeObjectURL(createImagePreview);
      if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    };
  }, [createImagePreview, editImagePreview]);

  const selectedProjects = useMemo(() => {
    if (!selectedDestination) return [];
    return projectsByDestination[selectedDestination] || [];
  }, [projectsByDestination, selectedDestination]);

  const createMutation = useMutation({
    mutationFn: ({ destination, name, facilities, minNights, beach, imageFile }) => {
      const fd = new FormData();
      fd.append('destination', destination);
      fd.append('name', name);
      fd.append('facilities', JSON.stringify(facilities || []));
      fd.append('min_nights', String(minNights));
      appendBeachFields(fd, beach || EMPTY_BEACH);
      if (imageFile) fd.append('image', imageFile);
      return catalogFetch('/projects', { method: 'POST', body: fd });
    },
    onSuccess: () => {
      toast.success('Project added — slide photo will show on the homepage');
      setProjectNameInput('');
      setDestinationInput('');
      setCreateFacilities([]);
      setCreateMinNights(2);
      setCreateBeach({ ...EMPTY_BEACH });
      clearCreateImage();
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
      qc.invalidateQueries({ queryKey: ['unit-projects'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name, facilities, minNights, beach, imageFile }) => {
      const fd = new FormData();
      if (name) fd.append('name', name);
      fd.append('facilities', JSON.stringify(facilities || []));
      fd.append('min_nights', String(minNights));
      appendBeachFields(fd, beach || EMPTY_BEACH);
      if (imageFile) fd.append('image', imageFile);
      return catalogFetch(`/projects/${id}`, { method: 'PUT', body: fd });
    },
    onSuccess: () => {
      toast.success('Project saved');
      setEditingId(null);
      setEditName('');
      setEditFacilities([]);
      setEditMinNights(2);
      setEditBeach({ ...EMPTY_BEACH });
      clearEditImage();
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
      qc.invalidateQueries({ queryKey: ['unit-projects'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const renameDestinationMutation = useMutation({
    mutationFn: ({ current, name }) =>
      catalogFetch(`/projects/destination/${encodeURIComponent(current)}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (data) => {
      const next = data?.renamedTo || destinationEditName.trim();
      const units = data?.unitsUpdated || 0;
      toast.success(
        units > 0
          ? `Destination renamed to “${next}” (${units} unit area(s) updated)`
          : `Destination renamed to “${next}”`
      );
      setSelectedDestination(next);
      setEditingDestination(false);
      setDestinationEditName('');
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
      qc.invalidateQueries({ queryKey: ['unit-projects'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['units'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (id) => catalogFetch(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Project removed — guest site will refresh on next load');
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
      qc.invalidateQueries({ queryKey: ['unit-projects'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteDestinationMutation = useMutation({
    mutationFn: (destination) =>
      catalogFetch(`/projects/destination/${encodeURIComponent(destination)}`, {
        method: 'DELETE',
      }),
    onSuccess: (data, destination) => {
      const units = data?.unitsStillTagged || 0;
      toast.success(
        units > 0
          ? `Deleted “${destination}” from the catalog (${data.deletedCount || 0} projects). ${units} unit(s) still have this area — reassign them if needed.`
          : `Deleted destination “${destination}” and its projects from the site catalog.`
      );
      setSelectedDestination('');
      refetch();
      qc.invalidateQueries({ queryKey: PROJECT_CATALOG_KEY });
      qc.invalidateQueries({ queryKey: ['unit-projects'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => toast.error(err.message),
  });

  function clearCreateImage() {
    if (createImagePreview) URL.revokeObjectURL(createImagePreview);
    setCreateImageFile(null);
    setCreateImagePreview('');
    if (createFileRef.current) createFileRef.current.value = '';
  }

  function clearEditImage() {
    if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    setEditImageFile(null);
    setEditImagePreview('');
    if (editFileRef.current) editFileRef.current.value = '';
  }

  function onPickCreateImage(file) {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (createImagePreview) URL.revokeObjectURL(createImagePreview);
    setCreateImageFile(file);
    setCreateImagePreview(URL.createObjectURL(file));
  }

  function onPickEditImage(file) {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    setEditImageFile(file);
    setEditImagePreview(URL.createObjectURL(file));
  }

  function handleCreate(e) {
    e.preventDefault();
    const destination = String(destinationInput || selectedDestination || '').trim();
    const name = String(projectNameInput || '').trim();
    if (!destination || !name) {
      toast.error('Both destination and project name are required');
      return;
    }
    if (!createImageFile) {
      toast.error('Add a homepage slide photo for this project');
      return;
    }
    const minNights = Math.max(1, parseInt(createMinNights, 10) || 2);
    createMutation.mutate({
      destination,
      name,
      facilities: createFacilities,
      minNights,
      beach: createBeach,
      imageFile: createImageFile,
    });
    setSelectedDestination(destination);
  }

  function handleDeleteDestination(destination) {
    const count = (projectsByDestination[destination] || []).length;
    const ok = confirm(
      `Delete destination “${destination}”?\n\nThis removes it and all ${count} project mapping(s) from the catalog.\nIt will disappear from homepage, search, and unit form pickers across the site.`
    );
    if (!ok) return;
    deleteDestinationMutation.mutate(destination);
  }

  function startEdit(row) {
    setEditingId(row.id);
    setEditName(row.name || '');
    setEditFacilities(Array.isArray(row.facilities) ? row.facilities : []);
    setEditMinNights(Math.max(1, Number(row.min_nights) || 2));
    setEditBeach(beachFromRow(row));
    clearEditImage();
  }

  function startEditDestination() {
    if (!selectedDestination) return;
    setEditingDestination(true);
    setDestinationEditName(selectedDestination);
  }

  function cancelEditDestination() {
    setEditingDestination(false);
    setDestinationEditName('');
  }

  function handleSaveDestination() {
    const name = String(destinationEditName || '').trim();
    if (!selectedDestination) return;
    if (!name) {
      toast.error('Destination name is required');
      return;
    }
    if (name.toLowerCase() === selectedDestination.toLowerCase() && name === selectedDestination) {
      cancelEditDestination();
      return;
    }
    renameDestinationMutation.mutate({ current: selectedDestination, name });
  }

  const selectedItems = items.filter((i) => i.destination === selectedDestination);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Destinations & Projects</h1>
        <p className="page-subtitle">
          Manage destination → project mappings, minimum stays, optional club access, homepage
          slide photos, and shared compound facilities.
        </p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary-600" /> Add mapping
        </h2>
        <div className="form-grid">
          <div>
            <label className="label">Existing destination</label>
            <select
              className="input"
              value={selectedDestination}
              onChange={(e) => setSelectedDestination(e.target.value)}
            >
              <option value="">Select destination…</option>
              {destinations.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Or new destination</label>
            <input
              className="input"
              value={destinationInput}
              onChange={(e) => setDestinationInput(e.target.value)}
              placeholder="e.g. Cairo"
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">Project name *</label>
            <input
              className="input"
              value={projectNameInput}
              onChange={(e) => setProjectNameInput(e.target.value)}
              placeholder="e.g. Mivida"
              required
            />
          </div>
          <div>
            <label className="label">Min stay (nights) *</label>
            <input
              type="number"
              min={1}
              step={1}
              className="input"
              value={createMinNights}
              onChange={(e) => setCreateMinNights(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Applied on guest booking calendars and manual reservations for units in this project.
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="label">Homepage slide photo *</label>
            <div
              className="mt-1 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-ch-line bg-slate-50 px-4 py-8 text-center cursor-pointer hover:border-[var(--pms-accent,#2f5d58)] hover:bg-slate-100/80"
              onClick={() => createFileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onPickCreateImage(e.dataTransfer.files?.[0]);
              }}
            >
              {createImagePreview ? (
                <img
                  src={createImagePreview}
                  alt="Slide preview"
                  className="max-h-40 w-full rounded-xl object-cover"
                />
              ) : (
                <ImagePlus className="h-8 w-8 text-slate-400" />
              )}
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {createImageFile ? 'Replace photo' : 'Upload slide photo'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Shown in the “Neighbourhoods” section on the main page. JPG, PNG, or WebP.
                </p>
              </div>
              <button type="button" className="btn-secondary text-xs">
                <Upload className="h-3.5 w-3.5" /> Choose file
              </button>
            </div>
            <input
              ref={createFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickCreateImage(e.target.files?.[0])}
            />
          </div>
          <TagSelect
            label="Facilities (shared by all units in this project)"
            placeholder="Select or type facilities…"
            suggestions={FACILITY_SUGGESTIONS}
            selectedTags={createFacilities}
            onTagsChange={setCreateFacilities}
          />
          <BeachAccessEditor beach={createBeach} setBeach={setCreateBeach} />
        </div>
        <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Saving…' : 'Add project'}
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="card p-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Destinations
          </p>
          {loadingCatalog ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : destinations.length === 0 ? (
            <p className="text-sm text-gray-400 px-1 py-2">No destinations left.</p>
          ) : (
            destinations.map((d) => (
              <div
                key={d}
                className={`group flex items-center gap-1 rounded-lg ${
                  selectedDestination === d ? 'bg-primary-50' : 'hover:bg-gray-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDestination(d);
                    setEditingDestination(false);
                    setDestinationEditName('');
                  }}
                  className={`min-w-0 flex-1 text-left rounded-lg px-3 py-2 text-sm font-medium ${
                    selectedDestination === d ? 'text-primary-700' : 'text-gray-700'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <MapPin className="w-4 h-4 shrink-0" />
                    <span className="truncate">{d}</span>
                  </span>
                  <span className="float-right text-xs text-gray-400 ml-2">
                    {(projectsByDestination[d] || []).length}
                  </span>
                </button>
                <button
                  type="button"
                  title={`Edit ${d}`}
                  aria-label={`Edit destination ${d}`}
                  className="rounded-lg p-2 text-gray-400 opacity-70 hover:bg-primary-50 hover:text-primary-700 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDestination(d);
                    setEditingDestination(true);
                    setDestinationEditName(d);
                  }}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title={`Delete ${d}`}
                  aria-label={`Delete destination ${d}`}
                  className="mr-1 rounded-lg p-2 text-gray-400 opacity-70 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                  disabled={deleteDestinationMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteDestination(d);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-header flex-wrap gap-3">
            <div className="min-w-0 flex-1">
              {editingDestination && selectedDestination ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input max-w-md"
                    value={destinationEditName}
                    onChange={(e) => setDestinationEditName(e.target.value)}
                    placeholder="Destination name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveDestination();
                      }
                      if (e.key === 'Escape') cancelEditDestination();
                    }}
                  />
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={renameDestinationMutation.isPending}
                    onClick={handleSaveDestination}
                  >
                    {renameDestinationMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={renameDestinationMutation.isPending}
                    onClick={cancelEditDestination}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <h2 className="text-lg font-semibold text-gray-900">
                  Projects in {selectedDestination || '…'}
                </h2>
              )}
            </div>
            {selectedDestination && !editingDestination ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={startEditDestination}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit destination
                </button>
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  disabled={deleteDestinationMutation.isPending}
                  onClick={() => handleDeleteDestination(selectedDestination)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete destination
                </button>
              </div>
            ) : null}
          </div>
          {selectedProjects.length === 0 ? (
            <div className="empty-state">
              <MapPin />
              <p>No projects yet for this destination.</p>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {selectedItems.map((row) => {
                const facilities = Array.isArray(row.facilities) ? row.facilities : [];
                const isEditing = editingId === row.id;
                const preview = isEditing && editImagePreview ? editImagePreview : row.image_url;
                return (
                  <div key={row.id} className="rounded-xl border border-gray-100 p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex gap-3 min-w-0">
                        <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                          {preview ? (
                            <img
                              src={preview}
                              alt={row.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-slate-300">
                              <ImagePlus className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900">{row.name}</p>
                          <p className="text-xs text-gray-400">{row.destination}</p>
                          <p className="mt-1 text-xs font-medium text-gray-600">
                            Min stay: {Number(row.min_nights) || 2} nights
                          </p>
                          {beachSummary(row) ? (
                            <p className="mt-1 text-xs font-medium text-sky-800">
                              Beach: {beachSummary(row)}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-gray-400">No club access</p>
                          )}
                          {!row.image_url && !editImagePreview ? (
                            <p className="mt-1 text-xs text-amber-700">No homepage slide photo yet</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {!isEditing ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={updateMutation.isPending}
                              onClick={() => {
                                const name = String(editName || '').trim();
                                if (!name) {
                                  toast.error('Project name is required');
                                  return;
                                }
                                updateMutation.mutate({
                                  id: row.id,
                                  name,
                                  facilities: editFacilities,
                                  minNights: Math.max(1, parseInt(editMinNights, 10) || 2),
                                  beach: editBeach,
                                  imageFile: editImageFile,
                                });
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => {
                                setEditingId(null);
                                setEditName('');
                                setEditFacilities([]);
                                setEditMinNights(2);
                                setEditBeach({ ...EMPTY_BEACH });
                                clearEditImage();
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="btn-sm btn-danger"
                          onClick={() => {
                            if (confirm(`Remove project “${row.name}”?`)) {
                              deleteProjectMutation.mutate(row.id);
                            }
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="space-y-3">
                        <div>
                          <label className="label">Project name *</label>
                          <input
                            className="input max-w-md"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            required
                          />
                        </div>
                        <div>
                          <label className="label">Min stay (nights) *</label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className="input max-w-[10rem]"
                            value={editMinNights}
                            onChange={(e) => setEditMinNights(e.target.value)}
                            required
                          />
                        </div>
                        <div>
                          <label className="label">Homepage slide photo</label>
                          <div
                            className="mt-1 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ch-line bg-slate-50 px-3 py-5 text-center cursor-pointer hover:bg-slate-100/80"
                            onClick={() => editFileRef.current?.click()}
                          >
                            <p className="text-xs text-slate-600">
                              {editImageFile ? 'New photo selected' : 'Click to replace photo'}
                            </p>
                            <button type="button" className="btn-secondary text-xs">
                              <Upload className="h-3.5 w-3.5" /> Choose file
                            </button>
                          </div>
                          <input
                            ref={editFileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => onPickEditImage(e.target.files?.[0])}
                          />
                        </div>
                        <TagSelect
                          label="Facilities"
                          placeholder="Select or type facilities…"
                          suggestions={FACILITY_SUGGESTIONS}
                          selectedTags={editFacilities}
                          onTagsChange={setEditFacilities}
                        />
                        <BeachAccessEditor beach={editBeach} setBeach={setEditBeach} />
                      </div>
                    ) : facilities.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {facilities.map((f) => (
                          <span
                            key={f}
                            className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No facilities set yet.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
