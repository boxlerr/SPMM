"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface Notification {
  id: string;
  message: string;
  type: "operario_created" | "operario_updated" | "operario_deleted";
  timestamp: Date;
  read: boolean;
  motivo?: string; // Motivo o detalles adicionales (solo para cambio de estado)
}

interface NotificationStorage {
  id: string;
  message: string;
  type: "operario_created" | "operario_updated" | "operario_deleted";
  timestamp: string;
  read: boolean;
  motivo?: string;
}

const STORAGE_KEY = "spmm_notifications";

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (message: string, type: Notification["type"], motivo?: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Cargar notificaciones desde localStorage al montar
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: NotificationStorage[] = JSON.parse(stored);
        const loadedNotifications: Notification[] = parsed.map((n) => ({
          ...n,
          timestamp: new Date(n.timestamp),
        }));
        setNotifications(loadedNotifications);
      }
    } catch (error) {
      console.error("Error al cargar notificaciones desde localStorage:", error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Guardar notificaciones en localStorage cada vez que cambien
  useEffect(() => {
    if (isLoaded) {
      try {
        const toStore: NotificationStorage[] = notifications.map((n) => ({
          id: n.id,
          message: n.message,
          type: n.type,
          timestamp: n.timestamp.toISOString(),
          read: n.read,
          motivo: n.motivo,
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      } catch (error) {
        console.error("Error al guardar notificaciones en localStorage:", error);
      }
    }
  }, [notifications, isLoaded]);

  const addNotification = (message: string, type: Notification["type"], motivo?: string) => {
    const newNotification: Notification = {
      id: `${Date.now()}-${Math.random()}`,
      message,
      type,
      timestamp: new Date(),
      read: false,
      motivo: motivo?.trim() || undefined,
    };
    setNotifications((prev) => [newNotification, ...prev]);
  };

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((notif) => (notif.id === id ? { ...notif, read: true } : notif))
    );
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((notif) => ({ ...notif, read: true })));
  };

  const clearNotifications = () => {
    setNotifications([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
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

