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
  const { isMobile, isMounted } = useIsMobile();
  const pathname = usePathname();
  const router = useRouter();

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
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
    <div 
      className={`
        fixed lg:relative top-0 left-0 h-full bg-white border-r border-gray-200 
        transition-all duration-300 ease-in-out z-50 lg:z-auto
        ${isCollapsed ? 'w-16' : 'w-64'}
        overflow-hidden
      `}
    >
      {/* Header */}
      <div className={`flex items-center border-b border-gray-200 ${isCollapsed ? 'justify-center p-4' : 'justify-between p-6'}`}>
        {!isCollapsed && (
          <div className="flex items-center">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
              <div className="w-4 h-4 bg-white rounded-sm"></div>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">SPMM</h1>
          </div>
        )}
        
        {/* Botón toggle */}
        <button
          onClick={toggleSidebar}
          className={`
            flex items-center justify-center w-8 h-8 hover:bg-gray-100 rounded-lg transition-colors
            ${isCollapsed ? 'mx-auto' : ''}
          `}
        >
          {isCollapsed ? (
            <ChevronRight className="h-5 w-5 text-gray-600" />
          ) : (
            <ChevronLeft className="h-5 w-5 text-gray-600" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className={`flex-1 space-y-2 ${isCollapsed ? 'p-2' : 'p-4'}`}>
        {sidebarItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                flex items-center rounded-xl transition-all duration-200 group
                ${isActive 
                  ? 'bg-blue-50 text-blue-600 shadow-sm' 
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                }
                ${isCollapsed ? 'justify-center p-3' : 'px-4 py-3'}
              `}
              title={isCollapsed ? item.name : undefined}
            >
              <Icon className={`
                h-5 w-5 transition-colors
                ${isActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-gray-700'}
                ${!isCollapsed ? 'mr-3' : ''}
              `} />
              
              {!isCollapsed && (
                <span className="font-medium text-sm">{item.name}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout Button */}
      <div className={`border-t border-gray-200 ${isCollapsed ? 'p-2' : 'p-4'}`}>
        <button
          onClick={handleLogout}
          className={`
            w-full flex items-center rounded-xl transition-all duration-200 group
            text-gray-700 hover:bg-red-50 hover:text-red-600
            ${isCollapsed ? 'justify-center p-3' : 'px-4 py-3'}
          `}
          title={isCollapsed ? "Cerrar Sesión" : undefined}
        >
          <LogOut className={`
            h-5 w-5 transition-colors
            text-gray-500 group-hover:text-red-600
            ${!isCollapsed ? 'mr-3' : ''}
          `} />
          
          {!isCollapsed && (
            <span className="font-medium text-sm">Cerrar Sesión</span>
          )}
        </button>
      </div>
    </div>
  );
}
