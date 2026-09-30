import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, ListTodo, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { ROLE_LABELS, canEditStaffTask } from '../utils/permissions';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchableSelect from '../components/ui/SearchableSelect';
import { formatDate, formatDateTime } from '../utils/formatters';

const EMPTY_FORM = { assignee_id: '', title: '', description: '', deadline: '' };

function isOverdue(deadline) {
  const iso = String(deadline || '').slice(0, 10);
  if (!iso) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  return iso < today;
}

export default function Tasks() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canAssignStaffTasks, isTaskAssignee, isReservationsManager, isAdmin } = usePermissions();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteTask, setDeleteTask] = useState(null);
  const [completeTask, setCompleteTask] = useState(null);
  const [completionComment, setCompletionComment] = useState('');
  const [replyTask, setReplyTask] = useState(null);
  const [replyBody, setReplyBody] = useState('');

  const {
    data: tasks = [],
    isLoading,
    isError,
    error: tasksError,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: ['staff-tasks'],
    queryFn: () => api.get('/staff-tasks').then((r) => r.data),
    retry: 2,
  });

  const {
    data: assignees = [],
    isLoading: assigneesLoading,
    isError: assigneesError,
  } = useQuery({
    queryKey: ['staff-task-assignees'],
    queryFn: () => api.get('/staff-tasks/assignees').then((r) => r.data),
    enabled: canAssignStaffTasks,
  });

  // Line managers only — and only once they actually have people they can assign to.
  const canAdd =
    canAssignStaffTasks &&
    !assigneesError &&
    (assigneesLoading || assignees.length > 0);

  const pageSubtitle = (() => {
    if (isTaskAssignee) {
      return 'Tasks assigned to you by your manager. You will also receive them by email.';
    }
    if (isReservationsManager) {
      return 'Assign missions and targets to the reservation team (web and manual agents).';
    }
    if (canAdd) {
      return 'Assign a title, description, and deadline to someone on your team. Only you can edit tasks you create.';
    }
    if (canAssignStaffTasks && assigneesLoading) {
      return 'Loading team members you can assign tasks to…';
    }
    if (canAssignStaffTasks) {
      return 'Set line managers in User Management, then assign tasks to staff who report to you.';
    }
    return 'Tasks assigned to your team appear here.';
  })();

  const emptySubtitle = (() => {
    if (isTaskAssignee) {
      return 'When your manager adds a task, it will show up here and in your email.';
    }
    if (isReservationsManager) {
      return 'Add a mission for a reservation agent. Every active web or manual agent is available.';
    }
    if (canAdd) {
      return 'Add a task for someone on your team.';
    }
    if (canAssignStaffTasks) {
      return 'Set line managers in User Management, then assign tasks to staff who report to you.';
    }
    return 'No tasks to show.';
  })();

  const addLabel = isReservationsManager ? 'Add mission' : 'Add task';
  const modalTitle = editingTask
    ? isReservationsManager
      ? 'Edit mission'
      : 'Edit task'
    : isReservationsManager
      ? 'New mission'
      : 'New task';
  const assigneePlaceholder = isReservationsManager
    ? 'Choose a reservation agent…'
    : 'Choose staff member…';

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/staff-tasks', payload).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['staff-tasks'] });
      if (data?.email_sent) {
        toast.success(`Task sent · emailed ${data.email_to}`);
      } else {
        toast.success('Task saved');
        toast.error(
          data?.email_error ||
            'Could not email the assignee. Check the email on their Users record.'
        );
      }
      closeModal();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not add task'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }) =>
      api.patch(`/staff-tasks/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-tasks'] });
      toast.success('Task updated');
      closeModal();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update task'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/staff-tasks/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-tasks'] });
      toast.success('Task deleted');
      setDeleteTask(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not delete task'),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, comment }) =>
      api.post(`/staff-tasks/${id}/complete`, { comment }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-tasks'] });
      toast.success('Task marked as done');
      setCompleteTask(null);
      setCompletionComment('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not mark task done'),
  });

  const {
    data: replyThread,
    isLoading: replyLoading,
    isFetching: replyFetching,
  } = useQuery({
    queryKey: ['staff-task-comments', replyTask?.id],
    queryFn: () =>
      api.get(`/staff-tasks/${replyTask.id}/comments`).then((r) => r.data?.items || []),
    enabled: !!replyTask?.id,
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, body }) =>
      api.post(`/staff-tasks/${id}/comments`, { body }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-task-comments', replyTask?.id] });
      qc.invalidateQueries({ queryKey: ['staff-tasks'] });
      setReplyBody('');
      toast.success('Reply sent');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not send reply'),
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditingTask(null);
    setForm(EMPTY_FORM);
  };

  const openAdd = () => {
    if (!assignees.length) {
      toast.error(
        isReservationsManager
          ? 'No reservation agents found. Add active Reservations (web or manual) staff in User Management.'
          : 'No eligible staff to assign yet. Add active non-manager employees in User Management.'
      );
      return;
    }
    setEditingTask(null);
    setForm({
      ...EMPTY_FORM,
      assignee_id: assignees.length === 1 ? String(assignees[0].id) : '',
    });
    setModalOpen(true);
  };

  const openEdit = (task) => {
    setEditingTask(task);
    setForm({
      assignee_id: String(task.assignee_id || ''),
      title: task.title || '',
      description: task.description || '',
      deadline: String(task.deadline || '').slice(0, 10),
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.assignee_id) {
      toast.error('Choose who this task is for');
      return;
    }
    if (!String(form.title || '').trim()) {
      toast.error('Title is required');
      return;
    }
    if (!form.deadline) {
      toast.error('Deadline is required');
      return;
    }
    const payload = {
      assignee_id: Number(form.assignee_id),
      title: form.title.trim(),
      description: form.description.trim(),
      deadline: form.deadline,
    };
    if (editingTask) {
      updateMutation.mutate({ id: editingTask.id, ...payload });
      return;
    }
    createMutation.mutate(payload);
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <LoadingSpinner />;

  if (isError) {
    const message = tasksError?.response?.data?.error || 'Refresh the page or try again in a moment.';
    return (
      <EmptyState
        icon={ListTodo}
        title="Could not load tasks"
        subtitle={message}
        action={
          <button type="button" onClick={() => refetchTasks()} className="btn-primary">
            Try again
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="page-header mb-0">
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">{pageSubtitle}</p>
        </div>
        {canAdd && (
          <button type="button" onClick={openAdd} className="btn-primary">
            <Plus className="w-4 h-4" /> {addLabel}
          </button>
        )}
      </div>

      {!tasks.length ? (
        <EmptyState
          icon={ListTodo}
          title={isTaskAssignee ? 'No tasks yet' : 'No tasks assigned'}
          subtitle={emptySubtitle}
          action={
            canAdd ? (
              <button type="button" onClick={openAdd} className="btn-primary">
                <Plus className="w-4 h-4" /> {addLabel}
              </button>
            ) : null
          }
        />
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => {
            const overdue = isOverdue(task.deadline) && !task.completed_at;
            const isMine = String(task.assignee_id) === String(user?.id);
            const canMarkDone = isMine && !task.completed_at;
            const canManage = canEditStaffTask(user, task);
            const cardStateClass = task.completed_at
              ? 'border border-emerald-200 bg-emerald-50/60'
              : overdue
                ? 'border border-rose-200 bg-rose-50/70'
                : '';
            return (
              <li
                key={task.id}
                className={`card p-5 ${cardStateClass}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2
                      className={`font-semibold text-ch-pine ${
                        task.completed_at ? 'line-through decoration-slate-400' : ''
                      }`}
                    >
                      {task.title}
                    </h2>
                    {isAdmin ? (
                      <p className="text-xs text-ch-muted mt-0.5">
                        From {task.created_by_name || '—'}
                        {' · '}
                        For {task.assignee_name || '—'}
                        {task.assignee_role
                          ? ` (${ROLE_LABELS[task.assignee_role] || task.assignee_role})`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    {task.completed_at ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800">
                        <Check className="w-3.5 h-3.5" />
                        Done
                      </span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg ${
                          overdue ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <CalendarDays className="w-3.5 h-3.5" />
                        {formatDate(task.deadline)}
                        {overdue ? ' · overdue' : ''}
                      </span>
                    )}
                    {canMarkDone ? (
                      <button
                        type="button"
                        className="btn-secondary text-xs px-2.5 py-1.5 text-emerald-700"
                        disabled={completeMutation.isPending}
                        onClick={() => {
                          setCompleteTask(task);
                          setCompletionComment('');
                        }}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Done
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-secondary text-xs px-2.5 py-1.5"
                      onClick={() => {
                        setReplyTask(task);
                        setReplyBody('');
                      }}
                      title="Reply with a comment"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Reply
                      {Number(task.comment_count) > 0 ? (
                        <span className="tabular-nums text-ch-muted">
                          ({Number(task.comment_count)})
                        </span>
                      ) : null}
                    </button>
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-ch-muted hover:bg-slate-100 hover:text-ch-pine"
                          title="Edit task"
                          onClick={() => openEdit(task)}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-ch-muted hover:bg-rose-50 hover:text-rose-700"
                          title="Delete task"
                          onClick={() => setDeleteTask(task)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {task.description ? (
                  <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">{task.description}</p>
                ) : (
                  <p className="mt-3 text-sm text-ch-muted">No description</p>
                )}
                {task.completed_at && task.completion_comment ? (
                  <p className="mt-2 text-xs text-emerald-800 whitespace-pre-wrap">
                    Done note: {task.completion_comment}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={modalTitle}
        footer={
          <>
            <button type="button" onClick={closeModal} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving
                ? 'Saving…'
                : editingTask
                  ? 'Save changes'
                  : isReservationsManager
                    ? 'Send mission'
                    : 'Send task'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Assign to *</label>
            <SearchableSelect
              value={form.assignee_id}
              onChange={(v) => setForm((f) => ({ ...f, assignee_id: v }))}
              placeholder={
                assigneesLoading
                  ? 'Loading team members…'
                  : assigneesError
                    ? 'Could not load team members'
                    : assigneePlaceholder
              }
              options={assignees.map((u) => ({
                value: String(u.id),
                label: `${u.full_name} (${ROLE_LABELS[u.role] || u.role})`,
              }))}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {isReservationsManager
                ? 'Every active reservation agent is listed. The email goes to the address on their Users record.'
                : 'The task email goes to the address saved on their Users record.'}
            </p>
          </div>
          <div>
            <label className="label">Title *</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Short task name"
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[120px]"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What needs to be done"
            />
          </div>
          <div>
            <label className="label">Deadline *</label>
            <input
              type="date"
              className="input w-48"
              value={form.deadline}
              onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!completeTask}
        onClose={() => {
          setCompleteTask(null);
          setCompletionComment('');
        }}
        title="Mark task done"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setCompleteTask(null);
                setCompletionComment('');
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={completeMutation.isPending}
              onClick={() => {
                const comment = String(completionComment || '').trim();
                if (!comment) {
                  toast.error('Add a completion comment');
                  return;
                }
                completeMutation.mutate({ id: completeTask.id, comment });
              }}
            >
              {completeMutation.isPending ? 'Saving…' : 'Confirm done'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {completeTask ? `Add a short note for “${completeTask.title}”.` : ''}
          </p>
          <div>
            <label className="label">Completion comment *</label>
            <textarea
              className="input min-h-[100px]"
              value={completionComment}
              onChange={(e) => setCompletionComment(e.target.value)}
              placeholder="What was completed / any notes"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!replyTask}
        onClose={() => {
          setReplyTask(null);
          setReplyBody('');
        }}
        title={replyTask ? `Reply · ${replyTask.title}` : 'Reply'}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setReplyTask(null);
                setReplyBody('');
              }}
              className="btn-secondary"
            >
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={replyMutation.isPending}
              onClick={() => {
                const body = String(replyBody || '').trim();
                if (!body) {
                  toast.error('Write a comment first');
                  return;
                }
                replyMutation.mutate({ id: replyTask.id, body });
              }}
            >
              {replyMutation.isPending ? 'Sending…' : 'Send reply'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {replyTask?.deadline ? (
            <p className="text-xs text-slate-500">
              Deadline {formatDate(replyTask.deadline)}
              {isOverdue(replyTask.deadline) && !replyTask.completed_at ? ' · overdue' : ''}
            </p>
          ) : null}
          <div className="max-h-64 overflow-y-auto space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            {replyLoading || replyFetching ? (
              <p className="text-sm text-ch-muted">Loading comments…</p>
            ) : !(replyThread || []).length ? (
              <p className="text-sm text-ch-muted">No replies yet. Add the first comment.</p>
            ) : (
              (replyThread || []).map((c) => (
                <div key={c.id} className="rounded-lg bg-white border border-slate-100 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">
                      {c.author_name || 'Staff'}
                      {String(c.author_id) === String(user?.id) ? ' (you)' : ''}
                    </span>
                    <span>{c.created_at ? formatDateTime(c.created_at) : ''}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{c.body}</p>
                </div>
              ))
            )}
          </div>
          <div>
            <label className="label">Your comment *</label>
            <textarea
              className="input min-h-[100px]"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Write an update or reply…"
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTask}
        onClose={() => setDeleteTask(null)}
        title="Delete task"
        danger
        confirmText="Delete"
        loading={deleteMutation.isPending}
        message={
          deleteTask
            ? `Remove “${deleteTask.title}”${deleteTask.assignee_name ? ` for ${deleteTask.assignee_name}` : ''}? This cannot be undone.`
            : ''
        }
        onConfirm={() => deleteMutation.mutate(deleteTask.id)}
      />
    </div>
  );
}
