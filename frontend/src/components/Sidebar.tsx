"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  Users, 
  Settings,
  FileText, 
  Calendar, 
  Package, 
  Target,
  Home,
  BarChart3,
  Search,
  LogOut,
  Menu,
  MoreVertical
} from "lucide-react";

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  status: "active" | "inactive" | "coming-soon";
}

const sidebarItems: SidebarItem[] = [
  {
    name: "Home",
    href: "/dashboard",
    icon: Home,
    status: "coming-soon"
  },
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: BarChart3,
    status: "coming-soon"
  },
  {
    name: "Planificación",
    href: "/planificacion",
    icon: Calendar,
    status: "active"
  },
  {
    name: "Recursos",
    href: "/recursos",
    icon: Users,
    status: "active"
  },
  {
    name: "Operarios",
    href: "/operarios",
    icon: Users,
    status: "active"
  },
  {
    name: "Procesos",
    href: "/procesos",
    icon: Settings,
    status: "active"
  },
  {
    name: "Artículos",
    href: "/articulos",
    icon: Package,
    status: "active"
  },
  {
    name: "Sectores",
    href: "/sectores",
    icon: Target,
    status: "inactive"
  },
  {
    name: "Órdenes",
    href: "/ordenes",
    icon: FileText,
    status: "inactive"
  },
  {
    name: "Prioridades",
    href: "/prioridades",
    icon: BarChart3,
    status: "inactive"
  }
];

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    // Simular logout - limpiar sesión y redirigir al login
    console.log('Cerrando sesión...');
    router.push('/login');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-500";
      case "inactive":
        return "bg-yellow-500";
      case "coming-soon":
        return "bg-gray-400";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className={`bg-gray-900 transition-all duration-300 h-screen flex flex-col ${
      isCollapsed ? "w-16" : "w-64"
    }`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          {!isCollapsed && (
            <div className="flex items-center">
              <div className="w-8 h-8 bg-[#3F3FF3] rounded-lg flex items-center justify-center mr-3">
                <div className="w-4 h-4 bg-white rounded-sm"></div>
              </div>
              <h1 className="text-xl font-semibold text-white">SPMM</h1>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Menu className="h-5 w-5 text-white" />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-4">
        {!isCollapsed ? (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search"
              className="w-full bg-gray-800 text-white placeholder-gray-400 rounded-lg pl-10 pr-4 py-2 border border-gray-700 focus:outline-none focus:border-[#3F3FF3]"
            />
          </div>
        ) : (
          <div className="flex justify-center">
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <Search className="h-5 w-5 text-white" />
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 space-y-1">
        {sidebarItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          const isHovered = hoveredItem === item.name;
          
          return (
            <div key={item.name} className="relative">
              <Link
                href={item.href}
                className={`flex items-center p-3 rounded-lg transition-colors group relative ${
                  isActive
                    ? "bg-gray-800 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                } ${item.status === "coming-soon" ? "opacity-50 cursor-not-allowed" : ""}`}
                onMouseEnter={() => setHoveredItem(item.name)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <Icon className={`h-5 w-5 ${isCollapsed ? "" : "mr-3"}`} />
                {!isCollapsed && (
                  <span className="font-medium">{item.name}</span>
                )}
                
                {/* Status indicator */}
                <div className={`absolute right-2 w-2 h-2 rounded-full ${getStatusColor(item.status)}`}></div>
              </Link>

              {/* Tooltip for collapsed state */}
              {isCollapsed && isHovered && (
                <div className="absolute left-full ml-2 top-1/2 transform -translate-y-1/2 bg-gray-800 text-white px-3 py-2 rounded-lg shadow-lg z-50 whitespace-nowrap">
                  <div className="flex items-center">
                    <span className="text-sm font-medium">{item.name}</span>
                    <div className={`ml-2 w-2 h-2 rounded-full ${getStatusColor(item.status)}`}></div>
                  </div>
                  <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-2 h-2 bg-gray-800 rotate-45"></div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="px-4">
        <div className="border-t border-gray-700"></div>
      </div>

      {/* Utility Navigation */}
      <div className="px-4 py-2 space-y-1">
        {!isCollapsed ? (
          <div 
            className="flex items-center p-3 rounded-lg hover:bg-red-600 transition-colors cursor-pointer"
            onClick={handleLogout}
          >
            <LogOut className="h-5 w-5 text-white mr-3" />
            <span className="text-white font-medium">Logout</span>
          </div>
        ) : (
          <button 
            className="p-3 rounded-lg hover:bg-red-600 transition-colors"
            onClick={handleLogout}
          >
            <LogOut className="h-5 w-5 text-white" />
          </button>
        )}
      </div>

      {/* User Profile */}
      <div className="p-4 border-t border-gray-700">
        <div className={`flex items-center ${isCollapsed ? "justify-center" : ""}`}>
          {!isCollapsed ? (
            <>
              <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center mr-3">
                <div className="w-6 h-6 bg-[#3F3FF3] rounded-full"></div>
              </div>
              <div className="flex-1">
                <div className="text-white font-medium text-sm">Admin User</div>
                <div className="text-gray-400 text-xs">admin@spmm.com</div>
              </div>
              <button className="p-1 hover:bg-gray-800 rounded-lg transition-colors">
                <MoreVertical className="h-4 w-4 text-gray-400" />
              </button>
            </>
          ) : (
            <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center">
              <div className="w-6 h-6 bg-[#3F3FF3] rounded-full"></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
