import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function capitalizeName(text?: string): string {
  if (!text) return "";
  return text
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Formatea los nombres en los mensajes de notificación
 * Busca patrones comunes y aplica capitalizeName a los nombres encontrados
 */
export function formatNotificationMessage(message: string): string {
  if (!message) return message;
  
  // Patrón 1: "Operario [nombre] [apellido] ..." (captura hasta "ha sido", "cambió", "eliminado" o fin de línea)
  message = message.replace(
    /(Operario\s+)([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+?)(\s+(?:ha sido|cambió|eliminado|fue)|$)/gi,
    (match, prefix, nombreCompleto, suffix) => {
      const nombres = nombreCompleto.trim().split(/\s+/);
      const nombresFormateados = nombres.map((n: string) => capitalizeName(n)).join(" ");
      return prefix + nombresFormateados + (suffix || "");
    }
  );
  
  // Patrón 2: "Usuario '[username]' ([nombre] [apellido]) ..."
  message = message.replace(
    /(Usuario\s+'[^']+'\s+\()([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+?)(\))/g,
    (match, prefix, nombreCompleto, suffix) => {
      const nombres = nombreCompleto.trim().split(/\s+/);
      const nombresFormateados = nombres.map((n: string) => capitalizeName(n)).join(" ");
      return prefix + nombresFormateados + suffix;
    }
  );
  
  // Patrón 3: "([nombre] [apellido]) ..." (para casos donde el nombre está entre paréntesis)
  message = message.replace(
    /(\()([A-Za-zÁÉÍÓÚáéíóúÑñ\s]{2,}?)(\))/g,
    (match, prefix, nombreCompleto, suffix) => {
      // Solo formatear si parece un nombre (más de una palabra y no es un username/email)
      const palabras = nombreCompleto.trim().split(/\s+/);
      if (palabras.length >= 2 && !nombreCompleto.includes("@") && !nombreCompleto.includes("'") && !nombreCompleto.match(/^\d/)) {
        const nombresFormateados = palabras.map((n: string) => capitalizeName(n)).join(" ");
        return prefix + nombresFormateados + suffix;
      }
      return match;
    }
  );
  
  return message;
}