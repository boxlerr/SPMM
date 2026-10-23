/**
 * Cuánto tarda el planificador en calcular un plan, para decirlo ANTES y mientras espera.
 *
 * Julián, 23/10/2026: «poner un tiempo estimado en la pantalla de carga». La barra decía un
 * porcentaje y los segundos transcurridos, pero no cuánto faltaba: con las 54 OT de Lucas
 * fueron cinco minutos sin saber si era normal.
 *
 * La cuenta es la del presupuesto del solver (backend/application/PlanificacionService.py,
 * `presupuesto_solver` y la segunda pasada): crece con los PROCESOS, no con las OT —una OT
 * de 3 pasos no pesa lo mismo que una de 20—. Las constantes son las mismas y un test del
 * backend (test_tiempo_del_calculo_front.py) las compara: si cambian allá, tienen que
 * cambiar acá.
 *
 * - `maximo`: lo más que puede tardar (los dos topes enteros, más leer y ordenar).
 * - `estimado`: lo que suele tardar. El solver corta solo cuando deja de mejorar. Medido el
 *   23/10 con las 54 OT de Lucas (360 procesos, 4 hilos como Cloud Run): la primera pasada
 *   cortó entre 42 y 79 s y la segunda llegó a sus 30; en total, de 77 a 114 s. La cuenta
 *   típica da 92 s para ese lote y ~50 s para uno de 6 OT (73 procesos).
 */

// Espejo de PlanificacionService.py (ver el test que las compara).
export const SOLVER_PISO_SEG = 40;
export const SOLVER_SEG_POR_PROCESO = 0.55;
export const SOLVER_MINIMO_SEG = 60;
export const SOLVER_TECHO_SEG_DEFAULT = 90;
export const SEGUNDA_PASADA_SEG_MAX = 30;

/** Leer las OT y los recursos, armar el modelo y ordenar el resultado. */
const ALREDEDOR_SEG = 8;

/** Los segundos de presupuesto de la primera pasada (presupuesto_solver). */
export function presupuestoSolver(cantProcesos: number): number {
    const cant = Math.max(0, Math.floor(cantProcesos || 0));
    const recta = SOLVER_PISO_SEG + SOLVER_SEG_POR_PROCESO * cant;
    return Math.max(1, Math.min(SOLVER_TECHO_SEG_DEFAULT, Math.max(SOLVER_MINIMO_SEG, Math.round(recta))));
}

export function tiempoDelCalculo(cantProcesos: number): { estimado: number; maximo: number } {
    const primera = presupuestoSolver(cantProcesos);
    const segunda = Math.max(15, Math.min(SEGUNDA_PASADA_SEG_MAX, primera / 2));
    const maximo = Math.round(ALREDEDOR_SEG + 4 + primera + segunda);
    const n = Math.max(0, cantProcesos || 0);
    const primeraTipica = Math.min(primera, 20 + 0.1 * n);
    const segundaTipica = Math.min(segunda, 10 + 0.05 * n);
    const estimado = Math.max(15, Math.round(ALREDEDOR_SEG + primeraTipica + segundaTipica));
    return { estimado, maximo };
}

/** «~45 s», «~1 min 30 s», «~2 min». */
export function textoDeSegundos(seg: number): string {
    const s = Math.max(0, Math.round(seg));
    if (s < 60) return `${Math.max(5, Math.round(s / 5) * 5)} s`;
    const min = Math.floor(s / 60);
    const resto = Math.round((s % 60) / 15) * 15;
    if (resto === 0 || resto === 60) return `${resto === 60 ? min + 1 : min} min`;
    return `${min} min ${resto} s`;
}
