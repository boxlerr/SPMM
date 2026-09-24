/**
 * El período de un reporte personalizado (RF-23): los atajos y cómo se dicen.
 *
 * Sin imports a propósito: tests/test_reportes_personalizados.py lo compila solo con el
 * tsc del repo y compara `rangoDelAtajo` con rango_del_atajo del servidor
 * (backend/application/ReportesCatalogo.py). El que manda es el servidor: esto es para
 * mostrar las fechas en la pantalla sin esperar la respuesta.
 */

export type Atajo = "este_mes" | "mes_pasado" | "ultimos_30" | "ultimos_90" | "este_anio";

export interface PeriodoConAtajo {
    columna?: string | null;
    atajo?: Atajo | null;
    desde?: string | null;
    hasta?: string | null;
}


const dos = (n: number) => String(n).padStart(2, "0");
export const isoDia = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;

/**
 * (desde, hasta) de un atajo, los dos días INCLUIDOS. Espejo de rango_del_atajo en
 * backend/application/ReportesCatalogo.py (un test compara las dos). El que manda es el
 * servidor: esto es para mostrar las fechas en la pantalla sin esperar la respuesta.
 */
export function rangoDelAtajo(atajo: Atajo, hoy: Date): { desde: string; hasta: string } {
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const dia = (a: number, mes: number, d: number) => isoDia(new Date(a, mes, d));
    const menos = (n: number) => isoDia(new Date(y, m, hoy.getDate() - n));
    switch (atajo) {
        case "este_mes":
            return { desde: dia(y, m, 1), hasta: dia(y, m + 1, 0) };
        case "mes_pasado":
            return { desde: dia(y, m - 1, 1), hasta: dia(y, m, 0) };
        case "ultimos_30":
            return { desde: menos(29), hasta: menos(0) };
        case "ultimos_90":
            return { desde: menos(89), hasta: menos(0) };
        case "este_anio":
            return { desde: dia(y, 0, 1), hasta: dia(y, 11, 31) };
    }
}

export const ATAJOS: { codigo: Atajo | "todo" | "rango"; texto: string }[] = [
    { codigo: "todo", texto: "Todo" },
    { codigo: "este_mes", texto: "Este mes" },
    { codigo: "mes_pasado", texto: "Mes pasado" },
    { codigo: "ultimos_30", texto: "30 días" },
    { codigo: "ultimos_90", texto: "90 días" },
    { codigo: "este_anio", texto: "Este año" },
    { codigo: "rango", texto: "Elegir fechas" },
];

export function fechaCorta(iso: string | null | undefined): string {
    if (!iso) return "";
    const [a, m, d] = iso.slice(0, 10).split("-");
    return a && m && d ? `${d}/${m}/${a}` : iso;
}

/** «Este mes (01/09 al 30/09)» / «Del 01/09/2026 al 15/09/2026» / «Todas las fechas». */
export function textoDelPeriodo(p: PeriodoConAtajo | null | undefined, hoy: Date = new Date()): string {
    if (!p || (!p.atajo && !(p.desde && p.hasta))) return "Todas las fechas";
    const rango = p.atajo ? rangoDelAtajo(p.atajo, hoy) : { desde: p.desde!, hasta: p.hasta! };
    const nombre = ATAJOS.find((a) => a.codigo === p.atajo)?.texto;
    const fechas = `${fechaCorta(rango.desde)} al ${fechaCorta(rango.hasta)}`;
    return nombre ? `${nombre} (${fechas})` : `Del ${fechas}`;
}

