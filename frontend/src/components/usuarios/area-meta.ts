/**
 * Cómo se presenta cada área y cada nivel en la pantalla «Usuarios y permisos» (RF-24).
 *
 * Es el area-meta.ts de Don Joaquín, con lo de SPMM: allá un área manda sobre páginas de
 * logística y finanzas; acá cada área es un ítem del menú. Centraliza el título corto y
 * QUÉ PANTALLAS CONTROLA cada área, para decirlo igual en la matriz, en los permisos
 * puntuales y en la ayuda. El permiso de verdad vive en la base y lo exige el backend
 * (backend/core/permisos_rutas.py): esto es sólo cómo se cuenta.
 *
 * Un test (backend/tests/test_permisos_admin_front.py) exige que estén todas las áreas del
 * catálogo, ni una más, y que cada solapa aparezca nombrada en las pantallas de su área:
 * si alguien agrega una solapa y no la cuenta acá, la ayuda mentiría por omisión.
 *
 * Sin `@/` a propósito: el test lo compila suelto.
 */
import type { AreaCodigo, Nivel } from "../../lib/permisos";

export interface AreaMeta {
  /** Cómo se llama en el menú. */
  titulo: string;
  /** Qué pantallas y qué cosas controla (las solapas, con su nombre tal cual). */
  pantallas: string[];
}

export const AREA_META: Record<AreaCodigo, AreaMeta> = {
  dashboard: {
    titulo: "Dashboard",
    pantallas: [
      "Dashboard: los indicadores del taller",
      "Rendimiento por persona (confidencial: compara a la gente con nombre y apellido)",
    ],
  },
  operaciones: {
    titulo: "Operaciones",
    pantallas: [
      "Órdenes de trabajo, con la ficha de cada OT (planos, materia prima, historial)",
      "Planificador: planificar, borradores, confirmar el plan y los feriados",
      "Recurso humano: lo que tiene asignado cada persona",
      "Materia prima: el stock mínimo de cada insumo",
    ],
  },
  planos: {
    titulo: "Planos",
    pantallas: [
      "Biblioteca de planos (también la solapa Planos de Recursos)",
      "Subir, reemplazar y borrar planos",
    ],
  },
  recursos: {
    titulo: "Recursos",
    pantallas: [
      "Recurso humano: las personas y lo que sabe hacer cada una",
      "Recurso maquinaria",
      "Procesos",
      "Rangos",
      "Sectores",
      "Prioridades",
    ],
  },
  clientes: {
    titulo: "Clientes",
    pantallas: ["Clientes: la cartera y sus contactos"],
  },
  no_conformidades: {
    titulo: "No conformidades",
    pantallas: ["No conformidades: registrarlas, editarlas y cerrarlas"],
  },
  auditoria: {
    titulo: "Auditoría",
    pantallas: ["Todo lo que se hizo", "Pasos de las OT", "Planificaciones"],
  },
  configuracion: {
    titulo: "Configuración",
    pantallas: [
      "Información del sistema",
      "Usuarios y permisos (confidencial: cambiarlos es sólo del Administrador)",
    ],
  },
};

/**
 * Lo que es de todos y no depende de ningún permiso. Esconderle a alguien «cambiar mi
 * contraseña» sería peor que cualquier cosa que el permiso quiera cuidar.
 */
export const LO_DE_TODOS: string[] = [
  "Mi cuenta (cambiar la contraseña)",
  "Notificaciones",
  "Novedades",
];

export const areaTitulo = (codigo: string, porDefecto?: string): string =>
  AREA_META[codigo as AreaCodigo]?.titulo ?? porDefecto ?? codigo;

export const areaPantallas = (codigo: string): string[] =>
  AREA_META[codigo as AreaCodigo]?.pantallas ?? [];

// Los niveles, dichos como los diría una persona (los mismos verbos que la auditoría:
// «le dio Clientes para ver», «para editar»).
export const NIVEL_INFO: Record<Nivel, { label: string; desc: string; clase: string }> = {
  none: {
    label: "Sin acceso",
    desc: "No la ve: ni aparece en el menú.",
    clase: "bg-gray-100 text-gray-600 border-gray-200",
  },
  read: {
    label: "Ver",
    desc: "La ve, pero no puede cambiar nada.",
    clase: "bg-blue-50 text-blue-700 border-blue-200",
  },
  write: {
    label: "Editar",
    desc: "Ve, carga, edita y borra.",
    clase: "bg-green-50 text-green-700 border-green-200",
  },
  admin: {
    label: "Todo",
    desc: "Todo, incluido manejar usuarios y permisos. Sólo el Administrador.",
    clase: "bg-amber-50 text-amber-800 border-amber-200",
  },
};

/** El color de la pastilla de cada rol. Los que se creen después van en gris. */
export function claseDeRol(codigo: string | null | undefined): string {
  switch (codigo) {
    case "admin":
      return "bg-amber-100 text-amber-800";
    case "supervisor":
      return "bg-blue-100 text-blue-800";
    case "operario":
      return "bg-green-100 text-green-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}
