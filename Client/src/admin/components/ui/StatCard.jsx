import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function StatCard({ title, value, subtitle, icon: Icon, iconBg = 'bg-primary-100', iconColor = 'text-primary-600', trend, trendLabel }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconBg}`}>
        {Icon && <Icon className={`w-6 h-6 ${iconColor}`} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 font-medium truncate">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5 truncate">{value}</p>
        {(subtitle || trend !== undefined) && (
          <div className="flex items-center gap-2 mt-1">
            {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
            {trend !== undefined && (
              <span className={`flex items-center gap-0.5 text-xs font-medium ${trend > 0 ? 'text-green-600' : trend < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                {trend > 0 ? <TrendingUp className="w-3 h-3" /> : trend < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                {trendLabel || `${Math.abs(trend)}%`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
