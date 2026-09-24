/**
 * El .xlsx de una exportación. Este módulo se pide con import() recién al tocar
 * «Excel»: trae exceljs, que es pesado, y ninguna pantalla lo carga de entrada.
 *
 * Lo que hace que la planilla sirva para trabajar y no sólo para mirar:
 *   · los números van como números y las fechas como fechas de Excel, con su formato
 *     (dd/mm/aaaa): se suman, se ordenan y se filtran;
 *   · la fila de títulos va en negrita, queda fija al bajar y trae autofiltro;
 *   · cada columna sale del ancho de lo que tiene, con un tope para los textos largos;
 *   · una hoja por sección (la OT: procesos y materias primas) y, al final, una hoja
 *     «Datos del reporte» con qué pantalla era, cuándo se generó y qué filtros tenía.
 */

import ExcelJS from "exceljs";
import {
    aBooleano,
    ahoraAR,
    aNumero,
    aTexto,
    neutralizarFormula,
    partesDeFecha,
    textoQueNoEsFecha,
    type ColumnaExport,
    type ReporteExport,
    type TipoColumna,
} from "./exportar";

/** Nombre válido de hoja: sin []:*?/\ y hasta 31 caracteres, sin repetirse. */
function nombreDeHoja(titulo: string, usados: Set<string>): string {
    const base = (titulo || "Hoja").replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Hoja";
    let nombre = base;
    for (let i = 2; usados.has(nombre.toLowerCase()); i++) {
        const sufijo = ` (${i})`;
        nombre = base.slice(0, 31 - sufijo.length) + sufijo;
    }
    usados.add(nombre.toLowerCase());
    return nombre;
}

const formatoNumero = (dec?: number) =>
    dec === undefined ? "General" : dec === 0 ? "#,##0" : `#,##0.${"0".repeat(dec)}`;

function formatoDe(col: ColumnaExport<any>): string | undefined {
    const tipo: TipoColumna = col.tipo ?? "texto";
    switch (tipo) {
        case "fecha": return "dd/mm/yyyy";
        case "fechaHora": return "dd/mm/yyyy hh:mm";
        case "entero": return "#,##0";
        case "id": return "0";
        case "moneda": return `"$" ${formatoNumero(col.decimales ?? 2)}`;
        case "porcentaje": {
            const dec = col.decimales ?? 1;
            return dec === 0 ? "0%" : `0.${"0".repeat(dec)}%`;
        }
        case "numero": return formatoNumero(col.decimales);
        default: return undefined;
    }
}

/**
 * El valor que va a la celda, del tipo que Excel entiende.
 *
 * Las fechas se arman con Date.UTC y los números de reloj del taller: exceljs pasa el
 * Date a número de serie contando en UTC, así que un Date local correría la hora tres
 * horas (y a medianoche, el día). Armado así, 22/09 07:00 del taller es 22/09 07:00 en
 * la celda, en cualquier computadora.
 */
function valorCelda(col: ColumnaExport<any>, crudo: unknown): ExcelJS.CellValue {
    const tipo: TipoColumna = col.tipo ?? "texto";
    switch (tipo) {
        case "fecha":
        case "fechaHora": {
            const p = partesDeFecha(crudo);
            if (!p) {
                const t = textoQueNoEsFecha(crudo);
                return t ? neutralizarFormula(t) : null;
            }
            return tipo === "fecha"
                ? new Date(Date.UTC(p.anio, p.mes - 1, p.dia))
                : new Date(Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo));
        }
        case "booleano": {
            const b = aBooleano(crudo);
            return b === null ? null : b ? "Sí" : "No";
        }
        case "numero":
        case "entero":
        case "id":
        case "moneda":
        case "porcentaje": {
            const n = aNumero(crudo);
            if (n === null) {
                const t = aTexto(crudo);
                return t ? neutralizarFormula(t) : null;
            }
            return tipo === "porcentaje" ? n / 100 : n;
        }
        default: {
            const t = aTexto(crudo);
            return t ? neutralizarFormula(t) : null;
        }
    }
}

/** Largo de lo que se va a ver, para el ancho de la columna. */
function largoVisible(valor: ExcelJS.CellValue, col: ColumnaExport<any>): number {
    if (valor === null || valor === undefined) return 0;
    if (valor instanceof Date) return (col.tipo ?? "texto") === "fechaHora" ? 16 : 10;
    if (typeof valor === "number") {
        // Con separador de miles y decimales, lo que se ve es un poco más largo que el número.
        const s = String(Math.round(valor * 100) / 100);
        return s.length + Math.floor(s.replace(/\D/g, "").length / 3) + ((col.tipo ?? "") === "moneda" ? 2 : 0);
    }
    const texto = String(valor);
    // El renglón más largo: un texto con saltos se lee en varios renglones.
    return texto.split(/\r?\n/).reduce((max, r) => Math.max(max, r.length), 0);
}

const ANCHO_MIN = 6;
const ANCHO_MAX = 60;

export async function construirXlsx(reporte: ReporteExport): Promise<Blob> {
    const libro = new ExcelJS.Workbook();
    libro.creator = "SPMM · Metalúrgica Longchamps";
    libro.title = reporte.titulo;
    libro.created = new Date();

    const usados = new Set<string>();

    for (const sec of reporte.secciones) {
        const hoja = libro.addWorksheet(nombreDeHoja(sec.titulo, usados), {
            views: [{ state: "frozen", xSplit: 0, ySplit: 1 }],
        });
        const anchos = sec.columnas.map((c) => Math.max(ANCHO_MIN, c.titulo.length + 2));

        const titulos = hoja.addRow(sec.columnas.map((c) => c.titulo));
        titulos.font = { bold: true };
        titulos.alignment = { vertical: "middle" };
        titulos.eachCell((celda) => {
            celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
            celda.border = { bottom: { style: "thin", color: { argb: "FF9CA3AF" } } };
        });

        const formatos = sec.columnas.map(formatoDe);
        const largos = sec.columnas.map(() => false);

        sec.filas.forEach((fila, idx) => {
            const valores = sec.columnas.map((c) => valorCelda(c, c.valor(fila, idx)));
            const renglon = hoja.addRow(valores);
            valores.forEach((v, i) => {
                const largo = largoVisible(v, sec.columnas[i]);
                if (largo + 2 > anchos[i]) anchos[i] = Math.min(ANCHO_MAX, largo + 2);
                if (largo > ANCHO_MAX - 2 || (typeof v === "string" && v.includes("\n"))) largos[i] = true;
                if (formatos[i] && v !== null) renglon.getCell(i + 1).numFmt = formatos[i]!;
            });
        });

        sec.columnas.forEach((_, i) => {
            const columna = hoja.getColumn(i + 1);
            columna.width = anchos[i];
            // Los textos largos (observaciones) se parten en renglones en vez de correrse
            // a las celdas de al lado.
            if (largos[i]) columna.alignment = { wrapText: true, vertical: "top" };
        });

        if (sec.columnas.length > 0) {
            hoja.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: sec.columnas.length },
            };
        }
    }

    // La última hoja dice qué es el archivo: si alguien lo encuentra dentro de un mes,
    // sin esto no sabe si es la lista entera o una parte filtrada.
    const info = libro.addWorksheet(nombreDeHoja("Datos del reporte", usados));
    const renglones: [string, ExcelJS.CellValue][] = [
        ["Reporte", neutralizarFormula(reporte.titulo)],
        ["Empresa", "Metalúrgica Longchamps"],
        ["Generado", ahoraAR()],
    ];
    const filtros = reporte.filtros ?? [];
    if (reporte.filtros === null) {
        // Una sola OT: no hay filtros de los que hablar.
    } else if (filtros.length === 0) {
        renglones.push(["Filtros", "Sin filtros: la lista completa de la pantalla"]);
    } else {
        const rotulo = reporte.rotuloFiltros || "Filtros";
        filtros.forEach((f, i) => renglones.push([i === 0 ? rotulo : "", neutralizarFormula(f)]));
    }
    reporte.secciones.forEach((sec) => {
        renglones.push([`Filas (${neutralizarFormula(sec.titulo)})`, sec.filas.length]);
    });
    renglones.forEach(([k, v]) => {
        const r = info.addRow([k, v]);
        r.getCell(1).font = { bold: true };
    });
    info.getColumn(1).width = 28;
    info.getColumn(2).width = 80;
    info.getColumn(2).alignment = { wrapText: true, vertical: "top" };

    const buffer = await libro.xlsx.writeBuffer();
    return new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
}
