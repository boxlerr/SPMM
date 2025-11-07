"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Bell, UserPlus, Pencil, UserMinus, CheckCircle2 } from "lucide-react";
import { useNotifications } from "../contexts/NotificationContext";
import { useRouter } from "next/navigation";

export default function Topbar() {
  const { notifications, unreadCount, markAsRead } = useNotifications();
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  if (!mounted) return null;

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "operario_created":
        return <UserPlus className="h-4 w-4 text-green-600" />;
      case "operario_updated":
        return <Pencil className="h-4 w-4 text-blue-600" />;
      case "operario_deleted":
        return <UserMinus className="h-4 w-4 text-red-600" />;
      default:
        return <Bell className="h-4 w-4 text-gray-600" />;
    }
  };

  const getNotificationBadge = (type: string) => {
    switch (type) {
      case "operario_created":
        return <span className="text-xs text-green-600 font-medium">Creado</span>;
      case "operario_updated":
        return <span className="text-xs text-blue-600 font-medium">Modificado</span>;
      case "operario_deleted":
        return <span className="text-xs text-red-600 font-medium">Eliminado</span>;
      default:
        return null;
    }
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return "Ahora";
    if (minutes < 60) return `Hace ${minutes}m`;
    if (hours < 24) return `Hace ${hours}h`;
    return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
  };

  const handleNotificationClick = (notificationId: string) => {
    markAsRead(notificationId);
    setIsOpen(false);
    router.push("/configuracion?tab=notificaciones");
  };

  const recentNotifications = notifications.slice(0, 5);

  return createPortal(
    (
      <div className="fixed z-[2147483647]" style={{ top: 16, right: 16 }}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="relative flex items-center justify-center w-11 h-11 rounded-full bg-white border shadow-md hover:shadow-lg hover:bg-gray-50 transition-all"
          title="Notificaciones"
          aria-label="Notificaciones"
        >
          <Bell className="h-5 w-5 text-gray-700" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] leading-5 text-center shadow-md">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {isOpen && (
          <div
            ref={dropdownRef}
            className="absolute top-14 right-0 w-80 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-96 overflow-hidden flex flex-col"
          >
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Notificaciones</h3>
                {unreadCount > 0 && (
                  <span className="text-xs text-gray-500">
                    {unreadCount} {unreadCount === 1 ? "no leída" : "no leídas"}
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {recentNotifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">No hay notificaciones</p>
                </div>
              ) : (
                <div className="py-2">
                  {recentNotifications.map((notification) => (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification.id)}
                      className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                        !notification.read ? "bg-blue-50/50" : ""
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex-shrink-0">
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getNotificationBadge(notification.type)}
                            {!notification.read && (
                              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
                            )}
                          </div>
                          <p
                            className={`text-sm ${
                              notification.read ? "text-gray-600" : "text-gray-900 font-medium"
                            } line-clamp-2`}
                          >
                            {notification.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatDate(notification.timestamp)}
                          </p>
                        </div>
                        {!notification.read && (
                          <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0 mt-1" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 5 && (
              <div className="p-3 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    router.push("/configuracion?tab=notificaciones");
                  }}
                  className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Ver todas las notificaciones
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    ),
    document.body
  );
}


