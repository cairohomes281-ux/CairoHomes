import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, ExternalLink, FileText, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { formatDateTime } from '../utils/formatters';

const EMPTY_JOB = {
  title: '',
  department: '',
  location: '',
  description: '',
  requirements: '',
  is_open: true,
};

const APP_STATUSES = ['Pending', 'Reviewed', 'Shortlisted', 'Rejected'];

const STATUS_CLASS = {
  Pending: 'bg-amber-50 text-amber-800 border-amber-200',
  Reviewed: 'bg-sky-50 text-sky-800 border-sky-200',
  Shortlisted: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Rejected: 'bg-red-50 text-red-800 border-red-200',
};

export default function JobOffers() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('offers');
  const [search, setSearch] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState(EMPTY_JOB);
  const [editId, setEditId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteJob, setDeleteJob] = useState(null);
  const [deleteApp, setDeleteApp] = useState(null);

  const { data: summary } = useQuery({
    queryKey: ['recruitment-summary'],
    queryFn: () => api.get('/recruitment/summary').then((r) => r.data),
  });

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['recruitment-jobs'],
    queryFn: () => api.get('/recruitment/jobs/manage').then((r) => r.data.items || []),
  });

  const { data: applications = [], isLoading: appsLoading } = useQuery({
    queryKey: ['recruitment-applications', jobFilter, statusFilter],
    queryFn: () =>
      api
        .get('/recruitment/applications', {
          params: {
            job_id: jobFilter || undefined,
            status: statusFilter || undefined,
          },
        })
        .then((r) => r.data.items || []),
  });

  const saveJob = useMutation({
    mutationFn: (payload) =>
      editId
        ? api.patch(`/recruitment/jobs/${editId}`, payload)
        : api.post('/recruitment/jobs', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruitment-jobs'] });
      qc.invalidateQueries({ queryKey: ['recruitment-summary'] });
      toast.success(editId ? 'Job offer updated' : 'Job offer posted');
      closeModal();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save job offer'),
  });

  const toggleOpen = useMutation({
    mutationFn: ({ id, is_open }) => api.patch(`/recruitment/jobs/${id}`, { is_open }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['recruitment-jobs'] });
      qc.invalidateQueries({ queryKey: ['recruitment-summary'] });
      toast.success(vars.is_open ? 'Offer is live on Careers' : 'Offer closed');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update offer'),
  });

  const removeJob = useMutation({
    mutationFn: (id) => api.delete(`/recruitment/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruitment-jobs'] });
      qc.invalidateQueries({ queryKey: ['recruitment-applications'] });
      qc.invalidateQueries({ queryKey: ['recruitment-summary'] });
      toast.success('Job offer deleted');
      setDeleteJob(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not delete offer'),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/recruitment/applications/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruitment-applications'] });
      qc.invalidateQueries({ queryKey: ['recruitment-jobs'] });
      qc.invalidateQueries({ queryKey: ['recruitment-summary'] });
      toast.success('Application updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update application'),
  });

  const removeApp = useMutation({
    mutationFn: (id) => api.delete(`/recruitment/applications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recruitment-applications'] });
      qc.invalidateQueries({ queryKey: ['recruitment-jobs'] });
      qc.invalidateQueries({ queryKey: ['recruitment-summary'] });
      toast.success('Application deleted');
      setDeleteApp(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not delete application'),
  });

  const q = search.trim().toLowerCase();
  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (!q) return true;
        return [job.title, job.department, job.location, job.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [jobs, q]
  );
  const filteredApps = useMemo(
    () =>
      applications.filter((row) => {
        if (!q) return true;
        return [row.full_name, row.fullName, row.email, row.phone, row.job_title]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [applications, q]
  );

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_JOB);
    setModalOpen(true);
  }

  function openEdit(job) {
    setEditId(job.id);
    setForm({
      title: job.title || '',
      department: job.department || '',
      location: job.location || '',
      description: job.description || '',
      requirements: job.requirements || '',
      is_open: Boolean(job.is_open),
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditId(null);
    setForm(EMPTY_JOB);
  }

  function submitJob() {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Title and description are required');
      return;
    }
    saveJob.mutate({
      title: form.title.trim(),
      department: form.department.trim(),
      location: form.location.trim(),
      description: form.description.trim(),
      requirements: form.requirements.trim(),
      is_open: form.is_open,
    });
  }

  function viewApplications(jobId) {
    setJobFilter(String(jobId));
    setTab('applications');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ch-muted">HR</p>
          <h1 className="page-title mt-1">Job offers</h1>
          <p className="page-subtitle">
            Post openings to the public Careers page and review CVs that come in.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/careers" target="_blank" rel="noreferrer" className="btn-secondary">
            <ExternalLink className="w-4 h-4" />
            View Careers
          </a>
          <button type="button" onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" />
            Post offer
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Open offers</p>
          <p className="mt-2 text-3xl font-bold text-[#2f5d58]">{summary?.openJobs ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Pending applications</p>
          <p className="mt-2 text-3xl font-bold text-amber-800">{summary?.pendingApplications ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">All applications</p>
          <p className="mt-2 text-3xl font-bold text-[#2f5d58]">{summary?.totalApplications ?? 0}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('offers')}
          className={`rounded-xl px-4 py-2 text-sm font-medium ${
            tab === 'offers' ? 'bg-ch-pine text-white' : 'bg-white border border-ch-line text-ch-pine'
          }`}
        >
          Offers
        </button>
        <button
          type="button"
          onClick={() => setTab('applications')}
          className={`rounded-xl px-4 py-2 text-sm font-medium ${
            tab === 'applications' ? 'bg-ch-pine text-white' : 'bg-white border border-ch-line text-ch-pine'
          }`}
        >
          Applications
        </button>
      </div>

      <SearchFilter
        value={search}
        onChange={setSearch}
        placeholder={tab === 'offers' ? 'Search job titles…' : 'Search applicant name, email, phone…'}
      >
        {tab === 'applications' ? (
          <>
            <select className="input w-48" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
              <option value="">All offers</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </select>
            <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {APP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </SearchFilter>

      {tab === 'offers' ? (
        jobsLoading ? (
          <LoadingSpinner />
        ) : filteredJobs.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No job offers yet"
            action={
              <button type="button" onClick={openCreate} className="btn-primary">
                <Plus className="w-4 h-4" />
                Post offer
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {filteredJobs.map((job) => (
              <div key={job.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg text-ch-pine">{job.title}</h3>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          job.is_open
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {job.is_open ? 'Live' : 'Closed'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ch-muted">
                      {[job.department, job.location].filter(Boolean).join(' · ') || 'No department or location'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => viewApplications(job.id)}
                    >
                      {job.application_count || 0} application{(job.application_count || 0) === 1 ? '' : 's'}
                      {job.pending_count ? ` · ${job.pending_count} new` : ''}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => openEdit(job)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => toggleOpen.mutate({ id: job.id, is_open: !job.is_open })}
                    >
                      {job.is_open ? 'Close' : 'Reopen'}
                    </button>
                    <button type="button" className="btn-secondary text-red-600" onClick={() => setDeleteJob(job)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {job.description ? (
                  <p className="mt-3 text-sm text-ch-muted whitespace-pre-line line-clamp-3">{job.description}</p>
                ) : null}
              </div>
            ))}
          </div>
        )
      ) : appsLoading ? (
        <LoadingSpinner />
      ) : filteredApps.length === 0 ? (
        <EmptyState icon={FileText} title="No applications yet" />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Offer</th>
                  <th>CV</th>
                  <th>Status</th>
                  <th>Applied</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredApps.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="font-medium text-ch-pine">{row.full_name || row.fullName}</div>
                      <div className="text-xs text-ch-muted">{row.email}</div>
                      {row.phone ? <div className="text-xs text-ch-muted">{row.phone}</div> : null}
                    </td>
                    <td>{row.job_title || '—'}</td>
                    <td>
                      {row.resume_url || row.cvUrl ? (
                        <a
                          href={row.resume_url || row.cvUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-ch-pine hover:underline"
                        >
                          <FileText className="w-4 h-4" />
                          Open CV
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <select
                        className={`input w-36 text-xs ${STATUS_CLASS[row.status] || ''}`}
                        value={row.status}
                        onChange={(e) => updateStatus.mutate({ id: row.id, status: e.target.value })}
                      >
                        {APP_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap">{row.created_at ? formatDateTime(row.created_at) : '—'}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="p-1.5 rounded-lg text-ch-muted hover:text-red-600"
                        onClick={() => setDeleteApp(row)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editId ? 'Edit job offer' : 'Post job offer'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={saveJob.isPending} onClick={submitJob}>
              {saveJob.isPending ? 'Saving…' : editId ? 'Save' : 'Post offer'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Reservations agent"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Department</label>
              <input
                className="input"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                placeholder="HR, Operations…"
              />
            </div>
            <div>
              <label className="label">Location</label>
              <input
                className="input"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="Cairo"
              />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[120px]"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Requirements</label>
            <textarea
              className="input min-h-[90px]"
              value={form.requirements}
              onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ch-pine">
            <input
              type="checkbox"
              checked={form.is_open}
              onChange={(e) => setForm((f) => ({ ...f, is_open: e.target.checked }))}
            />
            Publish on the public Careers page
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteJob}
        onClose={() => setDeleteJob(null)}
        onConfirm={() => deleteJob && removeJob.mutate(deleteJob.id)}
        title="Delete job offer"
        message={`Delete “${deleteJob?.title || ''}”? This also removes its applications.`}
        confirmText="Delete"
        danger
        loading={removeJob.isPending}
      />
      <ConfirmDialog
        open={!!deleteApp}
        onClose={() => setDeleteApp(null)}
        onConfirm={() => deleteApp && removeApp.mutate(deleteApp.id)}
        title="Delete application"
        message={`Delete the application from ${deleteApp?.full_name || deleteApp?.fullName || 'this candidate'}?`}
        confirmText="Delete"
        danger
        loading={removeApp.isPending}
      />
    </div>
  );
}
