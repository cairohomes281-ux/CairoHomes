import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuth } from '../../context/AuthContext';
import { roleThemeVars } from '../../utils/roleTheme';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return isMobile;
}

export default function Layout({ children }) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const role = user?.role || 'admin';
  const sidebarWidth = isMobile ? 0 : collapsed ? 64 : 256;

  return (
    <div
      className="pms-shell min-h-screen"
      data-pms-role={role}
      style={roleThemeVars(role)}
    >
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 bg-ch-ink/50 z-30 backdrop-blur-[2px]"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        collapsed={collapsed}
        isMobile={isMobile}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <Header
        onToggleSidebar={() => (isMobile ? setMobileOpen((v) => !v) : setCollapsed((v) => !v))}
        sidebarWidth={sidebarWidth}
      />

      <main
        className="pms-main pt-16 min-h-screen transition-all duration-300"
        style={{ marginLeft: sidebarWidth }}
      >
        <div className={isMobile ? 'p-3 sm:p-4' : 'p-6 lg:p-8'}>
          <div className="pms-content ch-fade-up">{children}</div>
        </div>
      </main>
    </div>
  );
}
