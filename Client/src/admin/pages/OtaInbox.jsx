import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MessageSquare, RefreshCw, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import { formatDateTime } from '../utils/formatters';

export default function OtaInbox() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState('');

  const { data: threadsData, isLoading } = useQuery({
    queryKey: ['ota-threads'],
    queryFn: () => api.get('/channel-manager/messages/threads?limit=100').then((r) => r.data),
    refetchInterval: 45000,
  });

  const { data: threadData, isLoading: threadLoading } = useQuery({
    queryKey: ['ota-thread', selectedId],
    queryFn: () => api.get(`/channel-manager/messages/threads/${selectedId}`).then((r) => r.data),
    enabled: Boolean(selectedId),
  });

  const replyMutation = useMutation({
    mutationFn: (body) =>
      api.post(`/channel-manager/messages/threads/${selectedId}/reply`, { body }).then((r) => r.data),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['ota-thread', selectedId] });
      qc.invalidateQueries({ queryKey: ['ota-threads'] });
      qc.invalidateQueries({ queryKey: ['ota-unread'] });
      toast.success('Message sent');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Send failed'),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post('/channel-manager/sync', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ota-threads'] });
      toast.success('Channels synced — messages refreshed');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Sync failed'),
  });

  const threads = threadsData?.threads || [];
  const thread = threadData?.thread;
  const messages = thread?.messages || [];

  const unreadTotal = useMemo(
    () => threads.reduce((sum, t) => sum + (Number(t.unread_count) || 0), 0),
    [threads]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">OTA Inbox</h1>
          <p className="page-subtitle">
            Guest messages from Booking.com and Airbnb Connectivity. Sync pulls new threads; reply sends
            via the channel API.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/calendar-sync" className="btn-secondary">
            Channel Manager
          </Link>
          <button
            type="button"
            className="btn-secondary"
            disabled={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Sync messages
          </button>
        </div>
      </div>

      {unreadTotal > 0 ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {unreadTotal} unread message{unreadTotal === 1 ? '' : 's'}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] min-h-[28rem]">
        <div className="rounded-2xl border border-ch-line bg-white overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-ch-line text-[11px] uppercase tracking-wider text-ch-muted font-semibold">
            Threads
          </div>
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : threads.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={MessageSquare}
                title="No OTA messages yet"
                description="Run Sync on Channel Manager after API credentials are connected."
              />
            </div>
          ) : (
            <ul className="divide-y divide-ch-line overflow-y-auto max-h-[70vh]">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left px-3 py-3 hover:bg-ch-pine-50/50 ${
                      selectedId === t.id ? 'bg-ch-pine-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-ch-pine text-sm truncate">
                        {t.guest_name || 'Guest'}
                      </p>
                      {Number(t.unread_count) > 0 ? (
                        <span className="shrink-0 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5">
                          {t.unread_count}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-ch-muted truncate">
                      {t.connection_name || t.provider_key} · {t.subject || 'Conversation'}
                    </p>
                    <p className="text-[11px] text-ch-muted mt-0.5">
                      {formatDateTime(t.last_message_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-ch-line bg-white flex flex-col min-h-[28rem]">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <EmptyState
                icon={MessageSquare}
                title="Select a thread"
                description="Choose a conversation from the list to read and reply."
              />
            </div>
          ) : threadLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-ch-line">
                <p className="font-semibold text-ch-pine">{thread?.guest_name || 'Guest'}</p>
                <p className="text-xs text-ch-muted">
                  {thread?.connection_name || thread?.provider_key}
                  {thread?.subject ? ` · ${thread.subject}` : ''}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[55vh]">
                {messages.length === 0 ? (
                  <p className="text-sm text-ch-muted">No messages in this thread yet.</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        m.direction === 'outbound'
                          ? 'ml-auto bg-ch-pine text-white'
                          : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p
                        className={`text-[10px] mt-1 ${
                          m.direction === 'outbound' ? 'text-white/70' : 'text-slate-500'
                        }`}
                      >
                        {m.sender_name ? `${m.sender_name} · ` : ''}
                        {formatDateTime(m.sent_at)}
                      </p>
                    </div>
                  ))
                )}
              </div>
              <form
                className="border-t border-ch-line p-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!draft.trim()) return;
                  replyMutation.mutate(draft.trim());
                }}
              >
                <input
                  className="input flex-1"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write a reply…"
                  disabled={replyMutation.isPending}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={replyMutation.isPending || !draft.trim()}
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
