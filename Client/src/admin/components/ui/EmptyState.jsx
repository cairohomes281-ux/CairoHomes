import { Inbox } from 'lucide-react';

export default function EmptyState({ icon: Icon = Inbox, title = 'No data found', subtitle, action }) {
  return (
    <div className="empty-state">
      <Icon className="w-14 h-14 mb-4 opacity-30" />
      <p className="font-semibold text-gray-500">{title}</p>
      {subtitle && <p className="text-sm mt-1 text-center max-w-xs">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
