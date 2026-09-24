/**
 * Lo que sale de Pendientes en papel o en archivo.
 *
 *  · «Imprimir» (hoja de la casa: ventana nueva con el HTML y `@media print`, logo y
 *    azul de Longchamps, como la OT impresa de CreateWorkOrderModal):
 *      – «como se ve»: la grilla filtrada, con casilleros para tildar a mano;
 *      – «agrupada por proveedor»: la lista para pedir. Un bloque por proveedor y, dentro,
 *        un renglón por insumo con la cantidad SUMADA de todas las OT y de qué OT sale
 *        cada parte («ABR117 · 5,6 Mts · 15692 (3,6) · 14534 (2)»): es lo que Maxi dicta
 *        por teléfono, no una línea por OT.
 *  · «Exportar» (ExportarMenu): las columnas de la grilla, para Excel/PDF/CSV.
 *
 * Todo sale de las filas que se VEN (con los filtros puestos), en el orden en que se ven.
 */

import { toast } from "@/lib/toast";
import type { ColumnaExport } from "@/lib/exportar";
import { estadoLinea, ESTADOS_LINEA, fmtCantidad, fmtFecha, type LineaPendiente } from "@/lib/materiaPrima";

/** Una fila lista para salir: la línea y los casilleros de su OT (los de la cañera de la pantalla). */
export interface FilaSalida {
    linea: LineaPendiente;
    celdas: string[];
}

const esc = (v: unknown) =>
    String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const tilde = (b: boolean) => (b ? "✔" : "");

export const COLUMNAS_EXPORT: ColumnaExport<FilaSalida>[] = [
    { titulo: "N° OT", tipo: "id", valor: (f) => f.linea.numero_ot },
    { titulo: "Fecha OT", tipo: "fecha", valor: (f) => f.linea.fecha_ot },
    { titulo: "Se necesita", tipo: "fecha", valor: (f) => f.linea.fecha_requerida },
    { titulo: "Código", valor: (f) => f.linea.codigo },
    { titulo: "Descripción", valor: (f) => f.linea.descripcion },
    { titulo: "Cant.", tipo: "numero", decimales: 3, valor: (f) => f.linea.cantidad },
    { titulo: "Un.", valor: (f) => f.linea.unidad ?? "" },
    { titulo: "Proveedor", valor: (f) => f.linea.proveedor ?? "" },
    { titulo: "Observaciones", valor: (f) => f.linea.observaciones ?? "" },
    { titulo: "Pedido", tipo: "booleano", valor: (f) => f.linea.pedido },
    { titulo: "Reserva", tipo: "booleano", valor: (f) => f.linea.reserva },
    { titulo: "Cant. reservada", tipo: "numero", decimales: 3, valor: (f) => (f.linea.reserva ? f.linea.cantidad_reservada : null) },
    { titulo: "Disponible", tipo: "booleano", valor: (f) => f.linea.disponible },
    { titulo: "Producción", tipo: "booleano", valor: (f) => f.linea.en_produccion || f.linea.ot_en_curso },
    { titulo: "Fecha prov.", tipo: "fecha", valor: (f) => f.linea.fecha_proveedor },
    { titulo: "F. entrega", tipo: "fecha", valor: (f) => f.linea.fecha_entrega },
    { titulo: "Stock libre", tipo: "numero", decimales: 3, valor: (f) => f.linea.stock_libre },
    { titulo: "Falta", tipo: "numero", decimales: 3, valor: (f) => f.linea.falta },
    { titulo: "Cañera", valor: (f) => f.celdas.join(" ") },
    { titulo: "Recortes", tipo: "entero", valor: (f) => f.linea.recortes_disponibles || null },
    { titulo: "Estado", valor: (f) => ESTADOS_LINEA[estadoLinea(f.linea)].rotulo },
];

const ESTILOS = `
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:11px}
.page{padding:10mm 9mm}
.head{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1e3a5f;padding-bottom:8px;margin-bottom:10px}
.logo{height:50px;width:auto}
.marca{display:flex;align-items:center;justify-content:center;height:50px;width:50px;border:3px solid #1e3a5f;
  border-radius:6px;font-size:20px;font-weight:bold;color:#1e3a5f;letter-spacing:-1px}
.head-c{flex:1}
.empresa{font-size:12px;color:#1e3a5f;font-weight:bold;letter-spacing:1px;text-transform:uppercase}
.doc{font-size:19px;font-weight:bold;line-height:1.15}
.head-r{text-align:right;font-size:10px;color:#555}
.filtros{font-size:10px;color:#444;margin:0 0 8px}
h2{font-size:12px;margin:14px 0 5px;border-bottom:2px solid #1e3a5f;padding-bottom:3px;color:#1e3a5f;
  text-transform:uppercase;letter-spacing:.6px;display:flex;justify-content:space-between;gap:12px}
h2 span{font-weight:normal;color:#555;text-transform:none;letter-spacing:0}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #999;padding:4px 5px;text-align:left;vertical-align:top}
th{background:#1e3a5f;color:#fff;text-transform:uppercase;font-size:8px;letter-spacing:.4px}
td.c,th.c{text-align:center}
td.n,th.n{text-align:right;white-space:nowrap}
td.caja{width:22px}
tr.ot td{border-top:2px solid #1e3a5f}
tr.lista td{background:#eef8f0}
tr.esperando td{background:#fff8e6}
.falta{color:#b91c1c;font-weight:bold}
.chico{font-size:9px;color:#555}
.pie{margin-top:10px;font-size:9px;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:5px}
@media print{.page{padding:6mm 7mm}th,tr.lista td,tr.esperando td{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  tr{page-break-inside:avoid}h2{page-break-after:avoid}}
`;

function encabezado(titulo: string, subtitulo: string) {
    const logo = `${window.location.origin}/longchamps_logo.png`;
    const hoy = new Date().toLocaleDateString("es-AR");
    return `
<div class="head">
  <img class="logo" src="${logo}" alt="Metalúrgica Longchamps" onerror="this.outerHTML='<div class=\\'marca\\'>ML</div>'">
  <div class="head-c"><div class="empresa">Metalúrgica Longchamps</div><div class="doc">${esc(titulo)}</div></div>
  <div class="head-r">${esc(subtitulo)}<br>Impreso ${esc(hoy)}</div>
</div>`;
}

function abrirVentana(html: string) {
    const w = window.open("", "_blank", "width=1100,height=760");
    if (!w) {
        toast.error("Habilitá las ventanas emergentes para poder imprimir.");
        return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    // Un momento para que el navegador termine de armar la hoja (y el logo) antes del diálogo.
    setTimeout(() => w.print(), 300);
}

/** La grilla como se ve: una fila por línea, agrupada por OT, con casilleros para tildar a mano lo que falte. */
export function imprimirGrilla(filas: FilaSalida[], titulo: string, subtitulo: string, filtros: string[]) {
    let otAnterior: number | null = null;
    const cuerpo = filas.length
        ? filas
            .map(({ linea: l, celdas }) => {
                const nueva = l.id_orden_trabajo !== otAnterior;
                otAnterior = l.id_orden_trabajo;
                const estado = estadoLinea(l);
                const clases = [nueva ? "ot" : "", estado === "lista" ? "lista" : estado === "esperando" ? "esperando" : ""]
                    .filter(Boolean)
                    .join(" ");
                return `<tr class="${clases}">
<td>${nueva ? `<b>${esc(l.numero_ot)}</b>${l.fecha_requerida ? `<div class="chico">nec. ${esc(fmtFecha(l.fecha_requerida))}</div>` : ""}` : ""}</td>
<td><b>${esc(l.codigo)}</b></td>
<td>${esc(l.descripcion)}</td>
<td class="n">${esc(fmtCantidad(l.cantidad))}</td>
<td>${esc(l.unidad ?? "")}</td>
<td>${esc(l.proveedor ?? "")}</td>
<td>${esc(l.observaciones ?? "")}</td>
<td class="c caja">${tilde(l.pedido)}</td>
<td class="c caja">${l.reserva ? `✔<div class="chico">${esc(fmtCantidad(l.cantidad_reservada))}</div>` : ""}</td>
<td class="c caja">${tilde(l.disponible)}</td>
<td class="c">${l.fecha_proveedor ? esc(fmtFecha(l.fecha_proveedor)) : ""}</td>
<td class="n">${esc(fmtCantidad(l.stock_libre))}</td>
<td class="n${l.falta > 0 ? " falta" : ""}">${l.falta > 0 ? esc(fmtCantidad(l.falta)) : ""}</td>
<td class="c">${esc(celdas.join(" "))}</td>
</tr>`;
            })
            .join("")
        : `<tr><td colspan="14" class="c" style="color:#999">No hay líneas con estos filtros</td></tr>`;

    abrirVentana(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>${ESTILOS}</style></head><body><div class="page">
${encabezado(titulo, subtitulo)}
${filtros.length ? `<p class="filtros">${filtros.map(esc).join(" · ")}</p>` : ""}
<table><thead><tr>
<th>OT</th><th>Código</th><th>Descripción</th><th class="n">Cant.</th><th>Un.</th><th>Proveedor</th><th>Obs.</th>
<th class="c">Ped.</th><th class="c">Res.</th><th class="c">Disp.</th><th class="c">F. prov.</th><th class="n">Libre</th><th class="n">Falta</th><th class="c">Cañera</th>
</tr></thead><tbody>${cuerpo}</tbody></table>
<div class="pie">${filas.length} línea${filas.length === 1 ? "" : "s"} · Materia prima › Pendientes · SPMM</div>
</div></body></html>`);
}

const normal = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/**
 * La lista para pedir: por proveedor y, dentro, por insumo, con las cantidades sumadas.
 * Se suma sólo lo que tiene la misma unidad (3 Mts y 2 Un del mismo código no se suman:
 * van en dos renglones). Las líneas sin proveedor van al final, en «Sin proveedor».
 */
export function imprimirPorProveedor(filas: FilaSalida[], titulo: string, subtitulo: string, filtros: string[]) {
    type Renglon = {
        codigo: string;
        descripcion: string;
        unidad: string;
        total: number;
        partes: { ot: string; cant: number }[];
        fechas: Set<string>;
        /** Todas sus líneas ya están pedidas: sale con la tilde puesta (la lista también sirve para mandarle al proveedor lo que se le encargó). */
        pedido: boolean;
    };
    const grupos = new Map<string, { nombre: string; renglones: Map<string, Renglon> }>();
    for (const { linea: l } of filas) {
        const clave = normal(l.proveedor) || "~";
        let g = grupos.get(clave);
        if (!g) {
            g = { nombre: l.proveedor?.trim() || "Sin proveedor", renglones: new Map() };
            grupos.set(clave, g);
        }
        const k = `${normal(l.codigo)}|${normal(l.unidad)}`;
        let r = g.renglones.get(k);
        if (!r) {
            r = { codigo: l.codigo, descripcion: l.descripcion, unidad: l.unidad ?? "", total: 0, partes: [], fechas: new Set(), pedido: true };
            g.renglones.set(k, r);
        }
        r.total += l.cantidad;
        r.partes.push({ ot: String(l.numero_ot ?? "—"), cant: l.cantidad });
        if (l.fecha_requerida) r.fechas.add(l.fecha_requerida);
        if (!l.pedido) r.pedido = false;
    }
    const ordenados = [...grupos.entries()].sort(([a, ga], [b, gb]) =>
        a === "~" ? 1 : b === "~" ? -1 : ga.nombre.localeCompare(gb.nombre, "es"),
    );

    const bloques = ordenados.length
        ? ordenados
            .map(([, g]) => {
                const renglones = [...g.renglones.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, "es"));
                const filasHtml = renglones
                    .map((r) => {
                        const primera = [...r.fechas].sort()[0];
                        return `<tr>
<td class="c caja">${r.pedido ? "✔" : ""}</td>
<td><b>${esc(r.codigo)}</b></td>
<td>${esc(r.descripcion)}</td>
<td class="n"><b>${esc(fmtCantidad(Math.round(r.total * 1000) / 1000))}</b></td>
<td>${esc(r.unidad)}</td>
<td class="chico">${r.partes.map((p) => `${esc(p.ot)} (${esc(fmtCantidad(p.cant))})`).join(" · ")}</td>
<td class="c">${primera ? esc(fmtFecha(primera)) : ""}</td>
</tr>`;
                    })
                    .join("");
                return `<h2>${esc(g.nombre)} <span>${renglones.length} insumo${renglones.length === 1 ? "" : "s"}</span></h2>
<table><thead><tr><th class="c" title="Tildado = ya pedido">Ped.</th><th>Código</th><th>Descripción</th><th class="n">Total</th><th>Un.</th><th>OT (cantidad)</th><th class="c">Se necesita</th></tr></thead>
<tbody>${filasHtml}</tbody></table>`;
            })
            .join("")
        : `<p style="color:#999;text-align:center">No hay líneas con estos filtros</p>`;

    abrirVentana(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>${ESTILOS}</style></head><body><div class="page">
${encabezado(titulo, subtitulo)}
${filtros.length ? `<p class="filtros">${filtros.map(esc).join(" · ")}</p>` : ""}
${bloques}
<div class="pie">Lista para pedir · ${filas.length} línea${filas.length === 1 ? "" : "s"} de OT · Materia prima › Pendientes · SPMM</div>
</div></body></html>`);
}
