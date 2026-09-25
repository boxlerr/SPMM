"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import {
  BarChart3,
  ArrowLeftRight,
  Users,
  Settings,
  X,
  Menu,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Briefcase,
  Ruler,
  Sparkles,
  FileWarning,
  Boxes
} from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAuth } from "../contexts/AuthContext";
import { capitalizeName } from "@/lib/utils";
import { MENU, puedeVerItem, type Permisos } from "@/lib/permisos";
import BotonAviso from "./BotonAviso";
import { useAvisoAlEntrar } from "@/hooks/useAvisoAlEntrar";

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
    // Materia prima: los insumos, las compras de la semana (Pendientes) y la cañera.
    // Desde el 24/09 se manejan acá y no en el sistema viejo. Va pegado a Operaciones
    // porque es la otra mitad de la misma orden: el material que la OT necesita para
    // poder arrancar. Las solapas van por `?tab=`, así el resaltado exacto de abajo
    // (pathname === href) la sigue marcando.
    name: "Materia prima",
    href: "/materia-prima",
    icon: Boxes
  },
  {
    // Planos: la biblioteca completa, para el que busca un plano por código de
    // producto y no tiene a mano la OT que lo usa. Va pegado a Operaciones porque es
    // la otra puerta al mismo archivo: desde la orden si sabés el número, desde acá
    // si lo que sabés es el código.
    name: "Planos",
    href: "/planos",
    icon: Ruler
  },
  {
    name: "Recursos",
    href: "/recursos",
    icon: Users
  },
  {
    name: "Clientes",
    href: "/clientes",
    icon: Briefcase
  },
  {
    name: "Configuración",
    href: "/configuracion",
    icon: Settings
  },
  {
    // No conformidades: lo que salió mal en una orden. Se cargan desde la orden —con el
    // ícono naranja al lado de cada paso— pero hasta ahora no había dónde verlas todas
    // juntas ni cómo bajarlas. Va al lado de Auditoría porque son las dos pantallas de
    // «qué pasó»: una con lo que hizo la gente y otra con lo que le pasó al trabajo.
    name: "No conformidades",
    href: "/no-conformidades",
    icon: FileWarning
  },
  {
    // Auditoría: cada intento de planificación (salga bien o mal) y cada borrado
    // quedan acá. Antes un intento fallado no dejaba rastro en la app y había que
    // ir a los logs del servidor para saber qué pasó.
    name: "Auditoría",
    href: "/auditoria",
    icon: ClipboardList
  },
  {
    // Novedades: el changelog para el equipo de la planta. Va último a propósito
    // (no es una pantalla de trabajo), pero fijo en el menú para que se encuentre.
    name: "Novedades",
    href: "/novedades",
    icon: Sparkles
  }
];

/**
 * RF-24: la barra muestra sólo lo que la persona puede LEER.
 *
 * Qué pide cada ítem no se decide acá: está en lib/permisos.ts (MENU), que es lo mismo
 * que usa la guardia de rutas, así el menú y el cartel de «no tenés acceso» no pueden
 * decir cosas distintas. Un test (test_permisos_front.py) exige que los `href` de esta
 * lista y los de MENU sean los mismos. Un ítem que no esté en MENU se muestra siempre:
 * ante la duda, como antes. Sin permisos (backend viejo), se ve todo.
 */
function itemsVisibles(permisos: Permisos | null): SidebarItem[] {
  return sidebarItems.filter((item) => {
    const delMenu = MENU.find((m) => m.href === item.href);
    return !delMenu || puedeVerItem(permisos, delMenu);
  });
}

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { isMobile, isMounted } = useIsMobile();
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user, permisos } = useAuth();
  const visibles = itemsVisibles(permisos);
  // El aviso que sale al entrar: el megáfono va pegado al nombre (BotonAviso) y no es un
  // ítem de `sidebarItems` a propósito, porque no lleva a ninguna pantalla (y esa lista
  // tiene que ser la de MENU, ver itemsVisibles).
  const { sinLeer: avisoSinLeer } = useAvisoAlEntrar();

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
    logout();
  };

  // No renderizar nada hasta que el componente esté montado
  if (!isMounted) {
    return (
      // `hidden lg:block`: antes de saber el ancho, el riel se dibujaba `fixed` también
      // en el teléfono y se sentaba encima del borde izquierdo del contenido hasta que
      // corría el efecto. Abajo de `lg` la barra real arranca escondida (se abre con el
      // botón flotante), así que el esqueleto tampoco tiene nada que mostrar ahí.
      <div className="hidden lg:block relative top-0 left-0 h-full bg-white border-r border-gray-200 w-16 overflow-hidden">
        <div className="flex items-center border-b border-gray-200 justify-center p-4">
          <div className="flex items-center justify-center w-8 h-8 bg-gray-100 rounded-lg">
            <div className="w-3 h-3 bg-gray-400 rounded-sm"></div>
          </div>
        </div>
        <nav className="flex-1 space-y-2 p-2">
          {visibles.map((item) => {
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
        `}
        style={{ overflow: isCollapsed && !isMobile ? 'visible' : 'hidden' }}
      >
        {/* Header */}
        <div className={`flex items-center border-b border-gray-200 transition-all duration-300 ${isMobile ? (
          isMobileOpen ? 'justify-between p-6' : 'justify-center p-4'
        ) : (
          isCollapsed ? 'justify-center p-4' : 'justify-between p-6'
        )
          }`}>
          {(!isMobile && !isCollapsed) || (isMobile && isMobileOpen) ? (
            <div className="flex items-center overflow-hidden">
              <Image
                src="/longchamps_logo.png"
                alt="Metalúrgica Longchamps"
                width={180}
                height={60}
                className="object-contain"
              />
            </div>
          ) : (
            <button
              onClick={toggleSidebar}
              className="bg-white rounded-lg p-1.5 flex items-center justify-center border-2 border-[#DC143C] shadow-sm hover:shadow-md hover:border-[#B8112E] transition-all duration-200 cursor-pointer"
              title="Abrir menú"
            >
              <Image
                src="/logo.png"
                alt="Metalúrgica Longchamps"
                width={28}
                height={28}
                className="object-contain"
              />
            </button>
          )}



          {/* Botón toggle - solo visible cuando el sidebar está abierto */}
          {((!isMobile && !isCollapsed) || (isMobile && isMobileOpen)) && (
            <button
              onClick={toggleSidebar}
              className="flex items-center justify-center w-8 h-8 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {isMobile ? (
                <X className="h-5 w-5 text-gray-600" />
              ) : (
                <ChevronLeft className="h-5 w-5 text-gray-600" />
              )}
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className={`flex-1 space-y-2 ${(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'p-2' : 'p-4'
          }`}>
          {visibles.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={closeMobileSidebar}
                className={`
                  flex items-center rounded-xl transition-all duration-200 group relative
                  ${isActive
                    ? 'bg-blue-50 text-blue-600 shadow-sm'
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }
                  ${(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'justify-center p-3' : 'px-4 py-3'}
                `}
                title={(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? item.name : undefined}
              >
                <Icon className={`
                  h-5 w-5 transition-colors flex-shrink-0
                  ${isActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-gray-700'}
                  ${(!isMobile && !isCollapsed) || (isMobile && isMobileOpen) ? 'mr-3' : ''}
                `} />

                {((!isMobile && !isCollapsed) || (isMobile && isMobileOpen)) && (
                  <span className="font-medium text-sm whitespace-nowrap transition-opacity duration-200">
                    {item.name}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User Info */}
        {user && (
          <div className={`border-t border-gray-200 ${(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'p-2' : 'p-4'
            }`}>
            {((!isMobile && !isCollapsed) || (isMobile && isMobileOpen)) ? (
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {capitalizeName(user.nombre)} {capitalizeName(user.apellido)}
                  </p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {user.username}
                  </p>
                </div>
                <BotonAviso alAbrir={closeMobileSidebar} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 p-2">
                <BotonAviso compacto alAbrir={closeMobileSidebar} />
                <div className="w-8 h-8 rounded-full bg-[#DC143C] text-white font-semibold flex items-center justify-center text-sm">
                  {/* Con `?.`: un usuario guardado sin nombre o sin apellido tumbaba la
                      app entera acá (el Sidebar está en todas las pantallas). */}
                  {(user.nombre?.charAt(0) ?? "").toUpperCase()}{(user.apellido?.charAt(0) ?? "").toUpperCase()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Logout Button */}
        <div className={`border-t border-gray-200 ${(!isMobile && isCollapsed) || (isMobile && !isMobileOpen) ? 'p-2' : 'p-4'
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
              h-5 w-5 transition-colors flex-shrink-0
              text-gray-500 group-hover:text-red-600
              ${(!isMobile && !isCollapsed) || (isMobile && isMobileOpen) ? 'mr-3' : ''}
            `} />

            {((!isMobile && !isCollapsed) || (isMobile && isMobileOpen)) && (
              <span className="font-medium text-sm whitespace-nowrap transition-opacity duration-200">
                Cerrar Sesión
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Botón flotante para móvil cuando sidebar está cerrada.
          `z-40` y no `z-[60]` (RF-27): por encima de la pantalla (las cabeceras y pies
          pegados van en z-30) pero por DEBAJO de los diálogos, que van en z-50. Con 60 el
          botón quedaba arriba del diálogo abierto y, en el teléfono, tapaba justo el
          «Cancelar» de la orden de trabajo y de cualquier formulario con el pie abajo. */}
      {isMobile && !isMobileOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed bottom-4 left-4 z-40 flex items-center justify-center w-14 h-14 bg-white border-2 border-[#DC143C] rounded-full shadow-lg hover:shadow-xl hover:border-[#B8112E] transition-all duration-200"
          title={avisoSinLeer ? "Abrir menú (hay un aviso sin leer)" : "Abrir menú"}
        >
          <Image
            src="/logo.png"
            alt="Metalúrgica Longchamps"
            width={32}
            height={32}
            className="object-contain"
          />
          {/* En el teléfono el megáfono queda adentro del menú cerrado: el puntito se
              asoma acá para que se sepa que adentro hay algo sin leer. */}
          {avisoSinLeer && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-[#DC143C] ring-2 ring-white"
            />
          )}
        </button>
      )}
    </>
  );
}
