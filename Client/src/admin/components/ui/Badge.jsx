import { getStatusConfig } from '../../utils/formatters';

export default function Badge({ status, label, className }) {
  const config = status ? getStatusConfig(status) : null;
  return (
    <span className={config ? config.className : (className || 'badge-gray')}>
      {label || config?.label || status}
    </span>
  );
}
