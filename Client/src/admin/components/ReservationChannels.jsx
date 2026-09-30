import { Globe, PenLine, Layers } from 'lucide-react';
import { RESERVATION_CHANNELS, reservationChannel } from '../utils/formatters';

export const CHANNEL_STYLES = {
  website: { color: '#2f5d58', soft: 'rgba(47,93,88,0.10)', Icon: Globe },
  manual: { color: '#b5725a', soft: 'rgba(181,114,90,0.12)', Icon: PenLine },
  airbnb: { color: '#d9475a', soft: 'rgba(217,71,90,0.10)', mark: 'A' },
  booking: { color: '#1f4e96', soft: 'rgba(31,78,150,0.10)', mark: 'B.' },
};

function ChannelMark({ channelKey, size = 'sm' }) {
  const s = CHANNEL_STYLES[channelKey];
  const box = size === 'sm' ? 'w-4 h-4 text-[9px]' : 'w-6 h-6 text-[11px]';
  const icon = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5';
  return (
    <span
      className={`${box} inline-flex items-center justify-center rounded-t-full rounded-b-[3px] font-bold text-white flex-shrink-0`}
      style={{ background: s.color }}
      aria-hidden
    >
      {s.Icon ? <s.Icon className={icon} strokeWidth={2.5} /> : s.mark}
    </span>
  );
}

export function ChannelBadge({ reservation }) {
  const ch = reservationChannel(reservation);
  const s = CHANNEL_STYLES[ch.key];
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className="inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap"
        style={{ background: s.soft, color: s.color }}
      >
        <ChannelMark channelKey={ch.key} />
        {ch.label}
      </span>
      {ch.detail ? <span className="text-[10px] text-gray-400 pl-1">{ch.detail}</span> : null}
    </span>
  );
}

/**
 * Channel switcher above the reservations table. `counts` holds per-channel totals
 * for the rows matching every other filter, so the numbers stay meaningful while switching.
 */
export function ChannelTabs({ value, onChange, counts }) {
  const total = RESERVATION_CHANNELS.reduce((sum, c) => sum + (counts[c.key] || 0), 0);
  const tabs = [{ key: '', label: 'All channels' }, ...RESERVATION_CHANNELS];

  return (
    <div className="rounded-2xl border border-ch-line bg-white p-2 shadow-sm">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
        {tabs.map((t) => {
          const active = value === t.key;
          const count = t.key ? counts[t.key] || 0 : total;
          const s = t.key ? CHANNEL_STYLES[t.key] : null;
          const share = t.key && total ? Math.round((count / total) * 100) : null;
          return (
            <button
              key={t.key || 'all'}
              type="button"
              onClick={() => onChange(t.key)}
              aria-pressed={active}
              className={`group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                active ? 'text-white shadow-sm' : 'hover:bg-ch-ivory'
              }`}
              style={active ? { background: s ? s.color : '#2f5d58' } : undefined}
            >
              {t.key ? (
                <span className={`inline-flex ${active ? 'rounded-t-full rounded-b-[4px] ring-2 ring-white/70' : ''}`}>
                  <ChannelMark channelKey={t.key} size="md" />
                </span>
              ) : (
                <span
                  className={`w-6 h-6 inline-flex items-center justify-center rounded-t-full rounded-b-[3px] ${
                    active ? 'bg-white/20' : 'bg-ch-rose text-ch-pine'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                </span>
              )}
              <span className="min-w-0">
                <span className={`block text-[11px] font-semibold uppercase tracking-[0.12em] ${active ? 'text-white/80' : 'text-ch-muted'}`}>
                  {t.label}
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className={`text-xl font-bold tabular-nums leading-tight ${active ? 'text-white' : 'text-ch-ink'}`}>
                    {count}
                  </span>
                  {share != null && (
                    <span className={`text-[11px] tabular-nums ${active ? 'text-white/70' : 'text-ch-muted'}`}>
                      {share}%
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {total > 0 && (
        <div className="mt-2 mx-1 flex h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
          {RESERVATION_CHANNELS.map((c) =>
            counts[c.key] ? (
              <span
                key={c.key}
                className="h-full transition-all"
                style={{
                  width: `${(counts[c.key] / total) * 100}%`,
                  background: CHANNEL_STYLES[c.key].color,
                  opacity: value && value !== c.key ? 0.25 : 1,
                }}
              />
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
