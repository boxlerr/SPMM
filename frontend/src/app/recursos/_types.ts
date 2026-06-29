// Sectores internos de Met Long para el alta/edición de operarios.
// Nota: estos son los departamentos propios de Met Long y son distintos del
// catálogo `dbo.sector` (sectores de órdenes del cliente, FK de orden_trabajo),
// por eso el dropdown de operarios usa esta lista fija y no GET /sectores.
export const SECTORES_OPERARIO = [
  "Compras",
  "Of.tecnica",
  "Administración",
  "Soldadura",
  "Corte y plegado",
  "Mecanizados",
  "Pañol",
] as const;

export interface ProcesoSkill {
  id_proceso: number;
  nombre_proceso?: string;
  nivel: number;
  habilitado: boolean;
}

export interface Operario {
  id: number;
  nombre: string;
  apellido: string;
  sector: string;
  categoria: string;
  disponible?: boolean;
  interpreta_planos?: boolean;
  telefono?: string;
  celular?: string;
  dni?: string;
  fecha_nacimiento?: string;
  fecha_ingreso?: string;
  email?: string;
  hora_inicio?: string;
  hora_fin?: string;
  dias_trabajo?: string;
  min_desayuno?: number;
  min_almuerzo?: number;
  rangos?: number[];
  skills?: ProcesoSkill[];
}

export interface Maquina {
  id: number;
  nombre: string;
  cod_maquina: string;
  limitacion?: string;
  capacidad?: string;
  especialidad?: string;
}


export interface Proceso {
  id: number;
  nombre: string;
  descripcion?: string;
}
