"use client";

import React, { useEffect, useState, createContext, useContext } from "react";
import { CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, type = "success", duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className="fixed top-4 right-20 z-[9998] animate-in fade-in slide-in-from-top-5 duration-300">
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border shadow-lg px-4 py-3 min-w-[300px] max-w-md",
          type === "success" && "bg-green-50 border-green-200 text-green-800",
          type === "error" && "bg-red-50 border-red-200 text-red-800",
          type === "info" && "bg-blue-50 border-blue-200 text-blue-800"
        )}
      >
        {type === "success" && <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />}
        <p className="flex-1 text-sm font-medium">{message}</p>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface ToastContextType {
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

