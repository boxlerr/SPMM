"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  BarChart3,
  ArrowLeftRight,
  Users,
  Settings,
  X,
  Menu,
  LogOut,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const sidebarItems: SidebarItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: BarChart3
  },
  {
    name: "Operaciones",
    href: "/operaciones",
    icon: ArrowLeftRight
  },
  {
    name: "Recursos",
    href: "/recursos",
    icon: Users
  },
  {
    name: "Configuración",
    href: "/configuracion",
    icon: Settings
  }
];

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { isMobile, isMounted } = useIsMobile();
  const pathname = usePathname();
  const router = useRouter();

  const toggleSidebar = () => {
    if (isMobile) {
      setIsMobileOpen(!isMobileOpen);
    } else {
      setIsCollapsed(!isCollapsed);
    }
  };

  const closeMobileSidebar = () => {
    if (isMobile) {
      setIsMobileOpen(false);
    }
  };

  const handleLogout = () => {
    // Limpiar cualquier dato de sesión almacenado
    localStorage.removeItem('user');
    sessionStorage.clear();
    
    // Redirigir al login
    router.push('/login');
  };

  // No renderizar nada hasta que el componente esté montado
  if (!isMounted) {
    return (
      <div className="fixed lg:relative top-0 left-0 h-full bg-white border-r border-gray-200 w-16 overflow-hidden">
        <div className="flex items-center border-b border-gray-200 justify-center p-4">
          <div className="flex items-center justify-center w-8 h-8 bg-gray-100 rounded-lg">
            <div className="w-3 h-3 bg-gray-400 rounded-sm"></div>
          </div>
        </div>
        <nav className="flex-1 space-y-2 p-2">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`
                  flex items-center justify-center p-3 rounded-xl transition-all duration-200
                  ${isActive 
                    ? 'bg-blue-50 text-blue-600 shadow-sm' 
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }
                `}
              >
                <Icon className={`
                  h-5 w-5 transition-colors
                  ${isActive ? 'text-blue-600' : 'text-gray-500'}
                `} />
              </Link>
            );
          })}
        </nav>
        
        {/* Logout Button - Estado inicial */}
        <div className="border-t border-gray-200 p-2">
          <button
            onClick={() => router.push('/login')}
            className="w-full flex items-center justify-center p-3 rounded-xl transition-all duration-200 text-gray-700 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-5 w-5 transition-colors text-gray-500 hover:text-red-600" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Overlay para móvil */}
      {isMobile && isMobileOpen && (
        <div 
          className="fixed inset-0 backdrop-blur-[1px] z-40 lg:hidden"
          onClick={closeMobileSidebar}
        />
      )}

      {/* Sidebar */}
      <div 
        className={`
          fixed lg:relative top-0 left-0 h-full bg-white border-r border-gray-200 
          transition-all duration-300 ease-in-out z-50 lg:z-auto
          ${isMobile ? (
            isMobileOpen ? 'translate-x-0 w-64' : '-translate-x-full w-0'
          ) : (
            isCollapsed ? 'w-16' : 'w-64'
          )}
          overflow-hidden
        `}
      >
        {/* Header */}
        <div className={`flex items-center border-b border-gray-200 ${
          isMobile ? (
            isMobileOpen ? 'justify-between p-6' : 'justify-center p-4'
          ) : (
            isCollapsed ? 'justify-center p-4' : 'justify-between p-6'
          )
        }`}>
          {(!isMobile && !isCollapsed) || (isMobile && isMobileOpen) ? (
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
                <div className="w-4 h-4 bg-white rounded-sm"></div>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">SPMM</h1>
            </div>
          ) : null}
          
          {/* Botón toggle */}
          <button
            onClick={toggleSidebar}
            className={`
              flex items-center justify-center w-8 h-8 hover:bg-gray-100 rounded-lg transition-colors
              ${(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'mx-auto' : ''}
            `}
          >
            {isMobile ? (
              isMobileOpen ? (
                <X className="h-5 w-5 text-gray-600" />
              ) : (
                <Menu className="h-5 w-5 text-gray-600" />
              )
            ) : (
              isCollapsed ? (
                <ChevronRight className="h-5 w-5 text-gray-600" />
              ) : (
                <ChevronLeft className="h-5 w-5 text-gray-600" />
              )
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 space-y-2 ${
          (!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'p-2' : 'p-4'
        }`}>
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={closeMobileSidebar}
                className={`
                  flex items-center rounded-xl transition-all duration-200 group
                  ${isActive 
                    ? 'bg-blue-50 text-blue-600 shadow-sm' 
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }
                  ${(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'justify-center p-3' : 'px-4 py-3'}
                `}
                title={(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? item.name : undefined}
              >
                <Icon className={`
                  h-5 w-5 transition-colors
                  ${isActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-gray-700'}
                  ${(!isMobile && !isCollapsed) || (isMobile && isMobileOpen) ? 'mr-3' : ''}
                `} />
                
                {((!isMobile && !isCollapsed) || (isMobile && isMobileOpen)) && (
                  <span className="font-medium text-sm">{item.name}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Logout Button */}
        <div className={`border-t border-gray-200 ${
          (!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'p-2' : 'p-4'
        }`}>
          <button
            onClick={handleLogout}
            className={`
              w-full flex items-center rounded-xl transition-all duration-200 group
              text-gray-700 hover:bg-red-50 hover:text-red-600
              ${(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'justify-center p-3' : 'px-4 py-3'}
            `}
            title={(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? "Cerrar Sesión" : undefined}
          >
            <LogOut className={`
              h-5 w-5 transition-colors
              text-gray-500 group-hover:text-red-600
              ${(!isMobile && !isCollapsed) || (isMobile && isMobileOpen) ? 'mr-3' : ''}
            `} />
            
            {((!isMobile && !isCollapsed) || (isMobile && isMobileOpen)) && (
              <span className="font-medium text-sm">Cerrar Sesión</span>
            )}
          </button>
        </div>
      </div>

      {/* Botón flotante para móvil cuando sidebar está cerrada */}
      {isMobile && !isMobileOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed bottom-4 left-4 z-[60] flex items-center justify-center w-12 h-12 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors"
        >
          <Menu className="h-6 w-6" />
        </button>
      )}
    </>
  );
}
