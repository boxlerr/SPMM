"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "./AuthContext";

export interface Notification {
  id: string; // Mantenemos string para compatibilidad con el frontend
  id_notificacion?: number; // ID de la base de datos
  message: string;
  type: string; // Ahora es mas abierto, viene del backend
  timestamp: Date;
  read: boolean;
  motivo?: string; // Motivo o detalles adicionales (solo para cambio de estado)
}

import { API_URL } from "@/config";

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  addNotification: (message: string, type: Notification["type"], motivo?: string) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const { token } = useAuth();

  // Función auxiliar para obtener headers con autenticación
  const getHeaders = () => {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  };

  // Cargar notificaciones desde el backend al montar
  useEffect(() => {
    const loadNotifications = async () => {
      if (!token) {
        setIsLoaded(true);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(`${API_URL}/notificaciones`, {
          method: "GET",
          headers: getHeaders(),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.status && result.data) {
            const loadedNotifications: Notification[] = result.data.map((n: any) => ({
              id: n.id_notificacion?.toString() || `${Date.now()}-${Math.random()}`,
              id_notificacion: n.id_notificacion,
              message: n.mensaje,
              type: n.tipo,
              timestamp: new Date(n.fecha_creacion),
              read: n.leida,
              motivo: n.motivo,
            }));
            setNotifications(loadedNotifications);
          }
        }
      } catch (error) {
        console.error("Error al cargar notificaciones desde el backend:", error);
      } finally {
        setLoading(false);
        setIsLoaded(true);
      }
    };

    loadNotifications();
  }, [token]);

  // Función para recargar notificaciones manualmente
  const reloadNotifications = async () => {
    if (!token) return;

    try {
      const response = await fetch(`${API_URL}/notificaciones`, {
        method: "GET",
        headers: getHeaders(),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.status && result.data) {
          const loadedNotifications: Notification[] = result.data.map((n: any) => ({
            id: n.id_notificacion?.toString() || `${Date.now()}-${Math.random()}`,
            id_notificacion: n.id_notificacion,
            message: n.mensaje,
            type: n.tipo,
            timestamp: new Date(n.fecha_creacion),
            read: n.leida,
            motivo: n.motivo,
          }));
          setNotifications(loadedNotifications);
        }
      }
    } catch (error) {
      console.error("Error al recargar notificaciones:", error);
    }
  };

  // 🔹 POLLING DE NOTIFICACIONES
  //
  // Antes esto era un WebSocket contra /ws/notifications. Se sacó por dos motivos:
  //
  // 1. Costo: Cloud Run factura CPU + RAM durante toda la vida de una conexión, y
  //    una conexión abierta se cobra igual que un request procesando, aunque no
  //    pase nada por ella. Con la app abierta toda la jornada eran ~14 h de
  //    instancia facturadas por día, contra ~20 s de todo el resto de la API junta.
  //
  // 2. Correctitud: el WSManager guardaba las conexiones en memoria de la instancia.
  //    Con maxScale > 1 un broadcast desde una instancia no llegaba a los clientes
  //    conectados a otra, así que las notificaciones ya se perdían en silencio.
  //
  // Toda notificación se persiste en la base ANTES de emitirse (ver
  // NotificationHandlers), así que el GET /notificaciones es la fuente de verdad
  // completa. Lo único que se pierde es inmediatez: hasta POLL_MS de demora.
  useEffect(() => {
    if (!isLoaded || typeof window === 'undefined' || !token) return;

    const POLL_MS = 30_000;

    // Con la pestaña en segundo plano no se consulta: en la planta las máquinas
    // quedan con SPMM abierto todo el día y ahí no hay nadie mirando el campanita.
    const poll = () => {
      if (document.hidden) return;
      reloadNotifications();
    };

    const interval = setInterval(poll, POLL_MS);

    // Al volver a la pestaña se consulta enseguida, para no esperar el ciclo.
    const onVisible = () => {
      if (!document.hidden) reloadNotifications();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isLoaded, token]);

  // Exponer la función para recargar manualmente
  useEffect(() => {
    // Agregar función al contexto global para que otros componentes puedan usarla
    (window as any).reloadNotifications = reloadNotifications;
  }, [token]);

  const addNotification = async (
    message: string,
    type: Notification["type"],
    motivo?: string
  ) => {
    if (!token) {
      // Si no hay token, crear notificación local temporal
      const newNotification: Notification = {
        id: `${Date.now()}-${Math.random()}`,
        message,
        type,
        timestamp: new Date(),
        read: false,
        motivo: motivo?.trim() || undefined,
      };
      setNotifications((prev) => [newNotification, ...prev]);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/notificaciones`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          mensaje: message,
          tipo: type,
          motivo: motivo?.trim() || null,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.status && result.data) {
          const newNotification: Notification = {
            id: result.data.id_notificacion?.toString() || `${Date.now()}-${Math.random()}`,
            id_notificacion: result.data.id_notificacion,
            message: result.data.mensaje,
            type: result.data.tipo,
            timestamp: new Date(result.data.fecha_creacion),
            read: result.data.leida,
            motivo: result.data.motivo,
          };
          setNotifications((prev) => [newNotification, ...prev]);
        }
      }
    } catch (error) {
      console.error("Error al crear notificación en el backend:", error);
      // Fallback: crear notificación local
      const newNotification: Notification = {
        id: `${Date.now()}-${Math.random()}`,
        message,
        type,
        timestamp: new Date(),
        read: false,
        motivo: motivo?.trim() || undefined,
      };
      setNotifications((prev) => [newNotification, ...prev]);
    }
  };

  const markAsRead = async (id: string) => {
    // Buscar el id_notificacion antes de actualizar
    const notification = notifications.find((n) => n.id === id);
    const idNotificacion = notification?.id_notificacion;

    // Actualizar localmente primero para respuesta inmediata
    setNotifications((prev) =>
      prev.map((notif) => (notif.id === id ? { ...notif, read: true } : notif))
    );

    // Actualizar en el backend si existe id_notificacion
    if (idNotificacion && token) {
      try {
        await fetch(`${API_URL}/notificaciones/${idNotificacion}/leida`, {
          method: "PUT",
          headers: getHeaders(),
        });
      } catch (error) {
        console.error("Error al marcar notificación como leída:", error);
        // Revertir cambio local si falla
        setNotifications((prev) =>
          prev.map((notif) => (notif.id === id ? { ...notif, read: false } : notif))
        );
      }
    }
  };

  const markAllAsRead = async () => {
    // Actualizar localmente primero
    setNotifications((prev) => prev.map((notif) => ({ ...notif, read: true })));

    if (token) {
      try {
        await fetch(`${API_URL}/notificaciones/leer-todas`, {
          method: "PUT",
          headers: getHeaders(),
        });
      } catch (error) {
        console.error("Error al marcar todas como leídas:", error);
      }
    }
  };

  const clearNotifications = async () => {
    if (token) {
      try {
        await fetch(`${API_URL}/notificaciones`, {
          method: "DELETE",
          headers: getHeaders(),
        });
      } catch (error) {
        console.error("Error al eliminar todas las notificaciones:", error);
      }
    }
    setNotifications([]);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error("useNotifications debe usarse dentro de NotificationProvider");
  }
  return context;
}

