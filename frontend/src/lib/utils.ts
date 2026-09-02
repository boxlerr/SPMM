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
 * Extrae el motivo de error del cuerpo (texto) de una respuesta del backend.
 * Soporta el formato ResponseDTO ({ errors: [{ message }] } y { errorDescription })
 * y el detail de FastAPI (string u objeto). Devuelve "" si no puede extraer un motivo
 * legible.
 *
 * El orden importa: los handlers de excepciones del backend escriben el motivo en
 * `errors[0].message` y dejan `errorDescription` en null, así que ese va primero.
 */
export function parseApiError(bodyText: string): string {
  if (!bodyText) return "";
  try {
    const b = JSON.parse(bodyText);
    if (Array.isArray(b?.errors) && b.errors.length > 0 && b.errors[0]?.message) {
      return String(b.errors[0].message);
    }
    if (typeof b?.errorDescription === "string" && b.errorDescription) {
      return b.errorDescription;
    }
    if (typeof b?.detail === "string") return b.detail;
    if (b?.detail?.message) return String(b.detail.message);
    if (typeof b?.message === "string") return b.message;
  } catch {
    // el cuerpo no era JSON
  }
  return "";
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

/**
 * Retorna la clase de color de fondo Tailwind acorde a la lógica manual del sistema legado,
 * basándose en el estado del material, procesos, subcontratación y programación de una Orden.
 */
export function getWorkOrderRowColor(order: any): string {
    // 1. VIOLETA: Tercerizado (Total o Parcial)
    if (order.tercerizado_total || order.tercerizado_parcial) {
        return "bg-purple-200/60 hover:bg-purple-300/60";
    }
    
    // 2. NARANJA: En Producción (en_proceso o tiene algún proceso con estado 2 = En Proceso)
    const enProceso = order.en_proceso || (order.procesos && order.procesos.some((p: any) => p.estado_proceso?.id === 2));
    if (enProceso) {
        return "bg-orange-200/60 hover:bg-orange-300/60";
    }

    // 3. VERDE OSCURO: Programada
    if (order.programada) {
        return "bg-emerald-300/60 hover:bg-emerald-400/60"; 
    }

    // 4. VERDE CLARO: Material Disponible ("ok")
    if (order.estado_material === 'ok') {
        return "bg-green-100 hover:bg-green-200/80"; 
    }

    // 5. AMARILLO: Material Pedido ("pedido")
    if (order.estado_material === 'pedido') {
        return "bg-yellow-100 hover:bg-yellow-200/80";
    }

    // 6. GRIS: Completa para pedir Materiales ("sin_stock" o por defecto)
    return "bg-gray-100 hover:bg-gray-200/80"; 
}
/**
 * ¿La OT ya está entregada / finalizada según el legacy?
 *
 *   (a) el cron la marcó finalizadototal=1 (regla oficial del legacy: cantidade>=cantidad,
 *       fc=1, suspendida=1, etc.) — es el caso más común. El cron NO siempre setea
 *       fecha_entrega porque en el legacy esa fecha queda en '1950-01-01' (sentinel)
 *       hasta que se facture, así que no podemos depender solo de fecha_entrega.
 *   (b) o tiene fecha_entrega real (>1950).
 *
 * `finalizadototal` es un entero 0/1/null en la base: se compara con Number() y no por
 * truthiness, para que un null o un "0" que llegue como texto no cuente como finalizada.
 */
export function isOrderDelivered(order: any): boolean {
    if (Number(order?.finalizadototal) === 1) return true;
    if (!order?.fecha_entrega) return false;
    const deliveryDate = new Date(order.fecha_entrega);
    return deliveryDate.getFullYear() > 1950;
}

/**
 * "Completada" = ya no tiene sentido verla entre el trabajo pendiente:
 *    - la marcó el legacy como entregada/finalizada (isOrderDelivered), o
 *    - se entregó todo lo pedido (lo mismo que muestra la columna Entrega
 *      como "Entrega completa": cantidad_entregada >= unidades).
 *
 * Es el ÚNICO criterio de "completada" del sistema: lo usan la pestaña Completadas de
 * Planificación y el reparto Planificadas / No Planificadas / Historial de Órdenes de
 * Trabajo. Si cada pantalla se arma el suyo, los contadores dejan de coincidir.
 */
export function isOrderCompleted(order: any): boolean {
    if (isOrderDelivered(order)) return true;
    const total = Number(order?.unidades) || 0;
    const entregado = Number(order?.cantidad_entregada) || 0;
    return total > 0 && entregado >= total;
}
