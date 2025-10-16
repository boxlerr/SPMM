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
  LogOut
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
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const { isMobile, isMounted } = useIsMobile();
  const pathname = usePathname();
  const router = useRouter();

  // Manejar hover para desktop
  const handleMouseEnter = () => {
    if (!isMobile) {
      setIsHovered(true);
      setIsOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (!isMobile) {
      setIsHovered(false);
      setIsOpen(false);
    }
  };

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  const closeSidebar = () => {
    if (isMobile) {
      setIsOpen(false);
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
      <div className="fixed lg:relative top-0 left-0 h-full bg-white border-r border-gray-200 w-16 lg:w-16 overflow-hidden lg:overflow-visible">
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
      {isMobile && isOpen && (
        <div 
          className="fixed inset-0 backdrop-blur-[1px] z-40 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <div 
        className={`
          fixed lg:relative top-0 left-0 h-full bg-white border-r border-gray-200 
          transition-all duration-300 ease-in-out z-50 lg:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${isOpen ? 'w-64' : 'w-0 lg:w-16'}
          overflow-hidden lg:overflow-visible
          ${isMobile && !isOpen ? 'hidden lg:block' : ''}
        `}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Header */}
        <div className={`flex items-center border-b border-gray-200 ${isOpen ? 'justify-between p-6' : 'justify-center p-4'}`}>
          {isOpen && (
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
                <div className="w-4 h-4 bg-white rounded-sm"></div>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">SPMM</h1>
            </div>
          )}
          
          {/* Botón toggle - solo visible en móvil */}
          {isMobile && (
            <button
              onClick={toggleSidebar}
              className="flex items-center justify-center w-10 h-10 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {isOpen ? (
                <X className="h-5 w-5 text-gray-600" />
              ) : (
                <Menu className="h-5 w-5 text-gray-600" />
              )}
            </button>
          )}
          
          {/* Indicador de hover para desktop cuando está cerrada */}
          {!isMobile && !isOpen && (
            <div className="flex items-center justify-center w-8 h-8 bg-gray-100 rounded-lg">
              <div className="w-3 h-3 bg-gray-400 rounded-sm"></div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className={`flex-1 space-y-2 ${isOpen ? 'p-4' : 'p-2'}`}>
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={closeSidebar}
                className={`
                  flex items-center rounded-xl transition-all duration-200 group
                  ${isActive 
                    ? 'bg-blue-50 text-blue-600 shadow-sm' 
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }
                  ${isOpen ? 'px-4 py-3' : 'justify-center p-3'}
                `}
              >
                <Icon className={`
                  h-5 w-5 transition-colors
                  ${isActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-gray-700'}
                  ${isOpen ? 'mr-3' : ''}
                `} />
                
                {isOpen && (
                  <span className="font-medium text-sm">{item.name}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Logout Button */}
        <div className={`border-t border-gray-200 ${isOpen ? 'p-4' : 'p-2'}`}>
          <button
            onClick={handleLogout}
            className={`
              w-full flex items-center rounded-xl transition-all duration-200 group
              text-gray-700 hover:bg-red-50 hover:text-red-600
              ${isOpen ? 'px-4 py-3' : 'justify-center p-3'}
            `}
          >
            <LogOut className={`
              h-5 w-5 transition-colors
              text-gray-500 group-hover:text-red-600
              ${isOpen ? 'mr-3' : ''}
            `} />
            
            {isOpen && (
              <span className="font-medium text-sm">Cerrar Sesión</span>
            )}
          </button>
        </div>
      </div>

      {/* Botón flotante para móvil cuando sidebar está cerrada */}
      {isMobile && !isOpen && (
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
