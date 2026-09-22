/**
 * Las listas cerradas de una máquina (RF-08): tipo y estado operativo.
 *
 * Las claves (`valor`) son lo que se guarda en la base y las valida el backend
 * (backend/application/MaquinariaService.py, TIPOS_MAQUINA y ESTADOS_OPERATIVOS). Un test
 * del backend lee ESTE archivo y compara: si se agrega un valor de un lado y no del otro,
 * se pone rojo antes de que la pantalla ofrezca algo que el backend rechaza con un 422.
 * Por eso el formato de las líneas `valor: "..."` importa: no lo cambies sin mirar
 * backend/tests/test_maquina_tipo_estado_mantenimiento.py.
 */
import type { Maquina } from "./_types";

/**
 * Qué clase de máquina es. Son las familias con las que el planificador clasifica
 * máquinas y procesos, más «Otro». Lista cerrada y no texto libre: el texto libre se
 * llena de variantes de la misma palabra.
 */
export const TIPOS_MAQUINA = [
  { valor: "TORNO", etiqueta: "Torno" },
  { valor: "FRESADORA", etiqueta: "Fresadora" },
  { valor: "AGUJEREADORA", etiqueta: "Agujereadora" },
  { valor: "LIMADORA", etiqueta: "Limadora" },
  { valor: "RECTIFICADORA", etiqueta: "Rectificadora" },
  { valor: "GUILLOTINA", etiqueta: "Guillotina" },
  { valor: "PRENSA", etiqueta: "Prensa" },
  { valor: "PLEGADORA", etiqueta: "Plegadora" },
  { valor: "SIERRA_CIRCULAR", etiqueta: "Sierra circular" },
  { valor: "OXICORTE", etiqueta: "Oxicorte" },
  { valor: "SOLDADORA_TIG", etiqueta: "Soldadora TIG" },
  { valor: "SOLDADORA_MIG", etiqueta: "Soldadora MIG/MAG" },
  { valor: "OTRO", etiqueta: "Otro" },
] as const;

/** Si la máquina está para trabajar. Hoy es informativo: el planificador no lo mira. */
export const ESTADOS_OPERATIVOS = [
  {
    valor: "operativa",
    etiqueta: "Operativa",
    clase: "bg-emerald-50 text-emerald-700 border-emerald-200",
    punto: "bg-emerald-500",
  },
  {
    valor: "en_mantenimiento",
    etiqueta: "En mantenimiento",
    clase: "bg-amber-50 text-amber-800 border-amber-300",
    punto: "bg-amber-500",
  },
  {
    valor: "fuera_de_servicio",
    etiqueta: "Fuera de servicio",
    clase: "bg-red-50 text-red-700 border-red-200",
    punto: "bg-red-500",
  },
] as const;

export type EstadoOperativo = (typeof ESTADOS_OPERATIVOS)[number]["valor"];

export const ESTADO_POR_DEFECTO: EstadoOperativo = "operativa";

export function etiquetaTipo(valor?: string | null): string | null {
  if (!valor) return null;
  return TIPOS_MAQUINA.find((t) => t.valor === valor)?.etiqueta ?? valor;
}

/**
 * El estado para dibujar. Un valor que no conocemos se muestra tal cual con el color
 * neutro en vez de disfrazarlo de «Operativa».
 */
export function infoEstado(valor?: string | null) {
  const v = valor || ESTADO_POR_DEFECTO;
  return (
    ESTADOS_OPERATIVOS.find((e) => e.valor === v) ?? {
      valor: v,
      etiqueta: v,
      clase: "bg-muted text-muted-foreground border-border",
      punto: "bg-muted-foreground",
    }
  );
}

/**
 * ¿El backend que contesta ya sabe de tipo, estado y frecuencia?
 *
 * El front se publica solo al pushear y el backend se deploya a mano, así que durante
 * un rato este front le habla a un backend que no tiene esas columnas. Ese backend
 * ignora los campos que no conoce: se vería un «guardado» y el dato no estaría. Así que
 * los controles nuevos aparecen sólo cuando la lista trae el campo —el backend nuevo lo
 * manda SIEMPRE, porque la columna es NOT NULL—. Con la lista vacía no se sabe, y se
 * elige lo de antes.
 */
export function backendConoceEstado(maquinas: Maquina[]): boolean {
  return maquinas.some((m) => m && m.estado_operativo !== undefined);
}
