/**
 * Exportar a PDF, Excel y CSV (RF-22) — lo común a todas las pantallas.
 *
 * QUÉ SE EXPORTA
 *
 * Lo que la persona está mirando: las filas con los filtros, la búsqueda y el orden que
 * tiene puestos en ese momento, no la tabla entera. Cada pantalla le pasa al botón las
 * filas que ya dibujó (ver `components/common/ExportarMenu`), así que exportar no va al
 * servidor: se arma acá, en el navegador, con lo que ya está cargado.
 *
 * LOS TRES FORMATOS NO SON TRES COPIAS DE LO MISMO
 *
 *   · PDF   → para leer, imprimir o mandar. Fechas dd/mm/aaaa y números con coma
 *             decimal, como se leen acá. Lleva el logo, el título, cuándo se generó y
 *             qué filtros tenía puestos la pantalla.
 *   · Excel → para trabajar. Los números y las fechas van como números y fechas DE
 *             VERDAD (se suman, se ordenan y se filtran), no como texto que se les
 *             parece. Títulos en negrita, fila de títulos fija y autofiltro.
 *   · CSV   → para cargar en otro sistema (RF-30). Estándar: coma, comillas según RFC
 *             4180, UTF-8 con BOM, números con punto y fechas aaaa-mm-dd. No está
 *             pensado para abrir en el Excel del taller (en es-AR la coma es el decimal):
 *             para eso está el .xlsx.
 *
 * FECHAS
 *
 * Todas las fechas del sistema son hora local de Argentina sin zona (ver
 * [[fechas-todas-sin-zona]]). Un «2026-09-22T00:00:00» se muestra como 22/09/2026 tal
 * cual: pasarlo por `new Date()` y después a UTC lo corre tres horas, y a medianoche
 * eso es el día anterior. `1950-01-01` es la marca del sistema viejo para «sin fecha»
 * y sale vacía.
 *
 * INYECCIÓN DE FÓRMULAS
 *
 * Los textos vienen de clientes, artículos y observaciones que tipea cualquiera. Una
 * celda que empieza con = + - @ (o tabulador o retorno de carro) la puede ejecutar
 * como fórmula la planilla que abra el archivo. En CSV y Excel esas celdas salen con un
 * apóstrofo adelante, que es la neutralización que recomienda OWASP.
 *
 * LIBRERÍAS
 *
 * exceljs (Excel) y jspdf + jspdf-autotable (PDF) se cargan recién al tocar el botón,
 * con import() dinámico: no pesan en la carga de ninguna pantalla. El paquete `xlsx` de
 * npm quedó abandonado con vulnerabilidades conocidas y no se usa.
 */

export type FormatoExport = "pdf" | "xlsx" | "csv";

/**
 * Cómo se lee el valor de una columna.
 *
 *  · texto      → tal cual.
 *  · numero     → decimal («1.234,5» en el PDF). `decimales` fija cuántos.
 *  · entero     → con separador de miles («1.234»).
 *  · id         → número sin separador de miles: N° de OT, códigos numéricos (15810, no 15.810).
 *  · moneda     → pesos con dos decimales.
 *  · porcentaje → el valor viene en puntos (12,5 = 12,5 %).
 *  · fecha      → dd/mm/aaaa.
 *  · fechaHora  → dd/mm/aaaa hh:mm.
 *  · booleano   → Sí / No.
 */
export type TipoColumna =
    | "texto"
    | "numero"
    | "entero"
    | "id"
    | "moneda"
    | "porcentaje"
    | "fecha"
    | "fechaHora"
    | "booleano";

export interface ColumnaExport<T> {
    titulo: string;
    /** El valor crudo de la fila: número, texto, fecha (texto del backend o Date) o null. */
    valor: (fila: T, indice: number) => unknown;
    tipo?: TipoColumna;
    /** Para numero / moneda / porcentaje. */
    decimales?: number;
    /**
     * En qué archivos va la columna. Sin esto, en los tres. Sirve cuando el PDF tiene que
     * decir en UNA celda lo que la planilla dice en varias: el PDF es una hoja apaisada
     * para leer y cada columna de más le achica las otras hasta partir números y nombres;
     * el Excel y el CSV no tienen ese límite y ahí conviene una columna por dato.
     */
    formatos?: FormatoExport[];
}

export interface SeccionExport<T = any> {
    /** Nombre de la hoja en el Excel y título de la tabla en el PDF y el CSV. */
    titulo: string;
    filas: T[];
    columnas: ColumnaExport<T>[];
}

export interface ReporteExport {
    /** Lo que dice arriba del PDF y en la hoja «Datos del reporte» del Excel. */
    titulo: string;
    /** Nombre del archivo sin fecha ni extensión: `ordenes_no_planificadas`. */
    archivo: string;
    /**
     * Resumen legible de los filtros puestos, un renglón por filtro. Vacío = la lista
     * sin filtrar (y el archivo lo dice). `null` = no aplica: una sola OT no tiene filtros.
     */
    filtros?: string[] | null;
    secciones: SeccionExport[];
    /** «auto» (por defecto) pone el PDF horizontal cuando la tabla no entra parada. */
    orientacion?: "auto" | "vertical" | "horizontal";
    /**
     * Lo que dice el PDF debajo del título. Sin esto, cuántas filas tiene cada tabla. El
     * armador de reportes (RF-23) dice «13 grupos de 17 filas»: su segunda tabla son los
     * totales y contarla como «Totales: 1» no le dice nada a nadie.
     */
    subtitulo?: string;
    /**
     * Cómo se llama el renglón de `filtros` en el PDF y en la hoja «Datos del reporte»
     * («Filtros» si no se dice). El armador de reportes (RF-23) dice «Criterios»: además de
     * los filtros trae de qué son los datos, cómo se agrupó y por qué se ordenó.
     */
    rotuloFiltros?: string;
}

/** Las columnas que van en ese formato (las que no dicen `formatos` van en todos). */
export function columnasPara<T>(formato: FormatoExport, columnas: ColumnaExport<T>[]): ColumnaExport<T>[] {
    return columnas.filter((c) => !c.formatos || c.formatos.includes(formato));
}

/** El reporte con las columnas de ese formato: lo primero que hace cada constructor. */
export function reporteParaFormato(reporte: ReporteExport, formato: FormatoExport): ReporteExport {
    return {
        ...reporte,
        secciones: reporte.secciones.map((sec) => ({ ...sec, columnas: columnasPara(formato, sec.columnas) })),
    };
}

// ---------------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------------

export interface PartesFecha {
    anio: number;
    mes: number; // 1-12
    dia: number;
    hora: number;
    minuto: number;
    segundo: number;
}

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
/** «25/09/2026» o «25/09/2026 14:30»: algunos listados ya mandan la fecha escrita. */
const RE_FECHA_AR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const partesLocales = (d: Date): PartesFecha => ({
    anio: d.getFullYear(),
    mes: d.getMonth() + 1,
    dia: d.getDate(),
    hora: d.getHours(),
    minuto: d.getMinutes(),
    segundo: d.getSeconds(),
});

/**
 * La fecha de un valor como la ve el taller: día y hora de reloj, sin zona.
 *
 * El texto sin zona que manda el backend se toma tal cual (no se convierte). Sólo lo
 * que trae zona explícita (una Z o un -03:00) o un Date se pasa a la hora de esta
 * computadora. Devuelve null si no hay fecha o si es la marca de «sin fecha» del
 * sistema viejo (1950) o el «3000» que usan algunos listados para lo que no vence.
 */
export function partesDeFecha(valor: unknown): PartesFecha | null {
    if (valor === null || valor === undefined || valor === "") return null;
    let p: PartesFecha | null = null;
    if (valor instanceof Date) {
        p = isNaN(valor.getTime()) ? null : partesLocales(valor);
    } else if (typeof valor === "string") {
        const texto = valor.trim();
        const m = RE_FECHA.exec(texto);
        const ar = m ? null : RE_FECHA_AR.exec(texto);
        if (ar) {
            p = {
                anio: Number(ar[3]),
                mes: Number(ar[2]),
                dia: Number(ar[1]),
                hora: Number(ar[4] ?? 0),
                minuto: Number(ar[5] ?? 0),
                segundo: Number(ar[6] ?? 0),
            };
        } else if (m && !m[7]) {
            p = {
                anio: Number(m[1]),
                mes: Number(m[2]),
                dia: Number(m[3]),
                hora: Number(m[4] ?? 0),
                minuto: Number(m[5] ?? 0),
                segundo: Number(m[6] ?? 0),
            };
        } else {
            const d = new Date(texto);
            p = isNaN(d.getTime()) ? null : partesLocales(d);
        }
    } else if (typeof valor === "number" && isFinite(valor)) {
        p = partesLocales(new Date(valor));
    }
    if (!p) return null;
    if (p.anio <= 1950 || p.anio >= 3000) return null;
    if (p.mes < 1 || p.mes > 12 || p.dia < 1 || p.dia > 31) return null;
    return p;
}

/**
 * Un texto que vino en una columna de fecha y no es una fecha («a confirmar»): se
 * muestra tal cual en vez de perderse. Vacío si era una fecha, aunque sea la marca de
 * «sin fecha» del sistema viejo, que tiene que salir vacía.
 */
export function textoQueNoEsFecha(valor: unknown): string {
    if (typeof valor !== "string") return "";
    const t = valor.trim();
    if (!t || RE_FECHA.test(t) || RE_FECHA_AR.test(t)) return "";
    return isNaN(new Date(t).getTime()) ? t : "";
}

const dos = (n: number) => String(n).padStart(2, "0");

export const fechaAR = (p: PartesFecha) => `${dos(p.dia)}/${dos(p.mes)}/${p.anio}`;
export const fechaHoraAR = (p: PartesFecha) => `${fechaAR(p)} ${dos(p.hora)}:${dos(p.minuto)}`;
const fechaISO = (p: PartesFecha) => `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
const fechaHoraISO = (p: PartesFecha) => `${fechaISO(p)} ${dos(p.hora)}:${dos(p.minuto)}:${dos(p.segundo)}`;

/** «22/09/2026 14:35» de ahora, para el «Generado el…». */
export function ahoraAR(): string {
    return fechaHoraAR(partesLocales(new Date()));
}

/** `ordenes_2026-09-22.pdf`: la fecha es la de hoy en esta computadora. */
export function nombreDeArchivo(base: string, formato: FormatoExport): string {
    const limpio = (base || "exportacion")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() || "exportacion";
    return `${limpio}_${fechaISO(partesLocales(new Date()))}.${formato}`;
}

// ---------------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------------

/** Número de lo que venga (número o texto numérico). null si no es un número. */
export function aNumero(valor: unknown): number | null {
    if (valor === null || valor === undefined || valor === "" || typeof valor === "boolean") return null;
    const n = typeof valor === "number" ? valor : Number(String(valor).trim());
    return isFinite(n) ? n : null;
}

export function aBooleano(valor: unknown): boolean | null {
    if (valor === null || valor === undefined || valor === "") return null;
    if (typeof valor === "boolean") return valor;
    if (typeof valor === "number") return valor !== 0;
    const t = String(valor).trim().toLowerCase();
    if (["1", "true", "si", "sí", "s"].includes(t)) return true;
    if (["0", "false", "no", "n"].includes(t)) return false;
    return null;
}

export function aTexto(valor: unknown): string {
    if (valor === null || valor === undefined) return "";
    if (valor instanceof Date) {
        const p = partesDeFecha(valor);
        return p ? fechaHoraAR(p) : "";
    }
    return String(valor);
}

const esNumerico = (tipo: TipoColumna) =>
    tipo === "numero" || tipo === "entero" || tipo === "id" || tipo === "moneda" || tipo === "porcentaje";

export const alineaDerecha = (tipo: TipoColumna = "texto") => esNumerico(tipo);

const decimalesDe = (col: ColumnaExport<any>, tipo: TipoColumna): number | undefined => {
    if (col.decimales !== undefined) return col.decimales;
    if (tipo === "moneda") return 2;
    if (tipo === "entero" || tipo === "id") return 0;
    return undefined;
};

const redondear = (n: number, dec?: number) =>
    dec === undefined ? n : Math.round(n * 10 ** dec) / 10 ** dec;

/**
 * Lo que se ve en el PDF: fechas dd/mm/aaaa y números con coma decimal y punto de miles.
 */
export function textoParaLeer(col: ColumnaExport<any>, crudo: unknown): string {
    const tipo = col.tipo ?? "texto";
    switch (tipo) {
        case "fecha":
        case "fechaHora": {
            const p = partesDeFecha(crudo);
            if (!p) return textoQueNoEsFecha(crudo);
            return tipo === "fecha" ? fechaAR(p) : fechaHoraAR(p);
        }
        case "booleano": {
            const b = aBooleano(crudo);
            return b === null ? "" : b ? "Sí" : "No";
        }
        case "numero":
        case "entero":
        case "moneda":
        case "porcentaje": {
            const n = aNumero(crudo);
            if (n === null) return aTexto(crudo);
            const dec = decimalesDe(col, tipo);
            if (tipo === "moneda") {
                // «$ 1.234,50» y «-$ 20,00», como escribe los pesos el resto del país.
                return new Intl.NumberFormat("es-AR", {
                    style: "currency",
                    currency: "ARS",
                    minimumFractionDigits: dec ?? 2,
                    maximumFractionDigits: dec ?? 2,
                }).format(n);
            }
            const f = new Intl.NumberFormat("es-AR", {
                minimumFractionDigits: 0,
                maximumFractionDigits: dec ?? 2,
            }).format(n);
            if (tipo === "porcentaje") return `${f} %`;
            return f;
        }
        case "id": {
            const n = aNumero(crudo);
            return n === null ? aTexto(crudo) : String(Math.round(n));
        }
        default:
            return aTexto(crudo);
    }
}

// ---------------------------------------------------------------------------------
// Inyección de fórmulas
// ---------------------------------------------------------------------------------

const PELIGROSO = /^[=+\-@\t\r]/;

/**
 * Una celda de texto que una planilla podría ejecutar como fórmula sale con un
 * apóstrofo adelante («=HYPERLINK(…)» → «'=HYPERLINK(…)»). Sólo se toca el texto: un
 * número negativo en una columna numérica es un número, no una fórmula.
 */
export function neutralizarFormula(texto: string): string {
    return PELIGROSO.test(texto) ? `'${texto}` : texto;
}

// ---------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------

/** El texto de una celda del CSV, sin comillas todavía. */
function valorCsv(col: ColumnaExport<any>, crudo: unknown): string {
    const tipo = col.tipo ?? "texto";
    switch (tipo) {
        case "fecha":
        case "fechaHora": {
            const p = partesDeFecha(crudo);
            if (!p) return neutralizarFormula(textoQueNoEsFecha(crudo));
            return tipo === "fecha" ? fechaISO(p) : fechaHoraISO(p);
        }
        case "booleano": {
            const b = aBooleano(crudo);
            return b === null ? "" : b ? "Sí" : "No";
        }
        case "numero":
        case "entero":
        case "id":
        case "moneda":
        case "porcentaje": {
            const n = aNumero(crudo);
            // Un número va con punto decimal y sin separador de miles: lo lee cualquier
            // sistema. Si la celda trae texto (un «—», un «sin datos»), va como texto.
            if (n === null) return neutralizarFormula(aTexto(crudo));
            return String(redondear(n, decimalesDe(col, tipo)));
        }
        default:
            return neutralizarFormula(aTexto(crudo));
    }
}

/** Comillas según RFC 4180: sólo si hace falta, y las comillas de adentro se duplican. */
function campoCsv(texto: string): string {
    return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * El CSV entero. Con una sola sección es una tabla limpia: una fila de títulos y los
 * datos. Con varias (la OT: procesos y materias primas) cada una va con su título en
 * un renglón propio y una línea en blanco entre medio.
 */
export function construirCsv(reporteCompleto: ReporteExport): string {
    const reporte = reporteParaFormato(reporteCompleto, "csv");
    const renglones: string[] = [];
    const varias = reporte.secciones.length > 1;
    reporte.secciones.forEach((sec, i) => {
        if (varias) {
            if (i > 0) renglones.push("");
            renglones.push(campoCsv(neutralizarFormula(sec.titulo)));
        }
        renglones.push(sec.columnas.map((c) => campoCsv(neutralizarFormula(c.titulo))).join(","));
        sec.filas.forEach((fila, idx) => {
            renglones.push(sec.columnas.map((c) => campoCsv(valorCsv(c, c.valor(fila, idx)))).join(","));
        });
    });
    // BOM: sin él, más de un programa lee «Metalúrgica» como «MetalÃºrgica».
    return "\uFEFF" + renglones.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------
// Descarga
// ---------------------------------------------------------------------------------

const TIPOS_MIME: Record<FormatoExport, string> = {
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv;charset=utf-8",
};

/** Baja el archivo sin salir de la pantalla (mismo camino que la descarga de planos). */
export function bajarArchivo(contenido: BlobPart, nombre: string, formato: FormatoExport): void {
    const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: TIPOS_MIME[formato] });
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement("a");
        a.href = url;
        a.download = nombre;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}

/**
 * Arma el archivo y lo baja. Devuelve el nombre, para el aviso de «listo».
 *
 * Excel y PDF viven en módulos aparte que se piden recién acá: son los que traen las
 * librerías pesadas, y así no viajan con ninguna pantalla hasta que alguien exporta.
 */
export async function exportarReporte(formato: FormatoExport, reporte: ReporteExport): Promise<string> {
    const nombre = nombreDeArchivo(reporte.archivo, formato);
    if (formato === "csv") {
        bajarArchivo(construirCsv(reporte), nombre, "csv");
    } else if (formato === "xlsx") {
        const { construirXlsx } = await import("./exportarXlsx");
        bajarArchivo(await construirXlsx(reporte), nombre, "xlsx");
    } else {
        const { construirPdf } = await import("./exportarPdf");
        bajarArchivo(await construirPdf(reporte), nombre, "pdf");
    }
    return nombre;
}

// ---------------------------------------------------------------------------------
// Ayudas para armar el resumen de filtros
// ---------------------------------------------------------------------------------

/** «Búsqueda: «abc»» si hay algo escrito; nada si no. */
export function filtroBusqueda(texto: string | null | undefined, rotulo = "Búsqueda"): string[] {
    const t = (texto ?? "").trim();
    return t ? [`${rotulo}: «${t}»`] : [];
}

/** «Rótulo: valor» sólo si el valor dice algo. */
export function filtroSi(rotulo: string, valor: unknown): string[] {
    if (valor === null || valor === undefined || valor === "" || valor === false) return [];
    if (Array.isArray(valor)) return valor.length ? [`${rotulo}: ${valor.join(", ")}`] : [];
    if (valor === true) return [rotulo];
    return [`${rotulo}: ${String(valor)}`];
}

/** Un «aaaa-mm-dd» del filtro de fechas, leído como fecha del taller. */
export function fechaDeFiltro(valor: string | null | undefined): string {
    const p = partesDeFecha(valor ?? null);
    return p ? fechaAR(p) : String(valor ?? "");
}
