/**
 * Lo que sale de Pendientes en papel o en archivo.
 *
 *  · «Imprimir» (hoja de la casa: ventana nueva con el HTML y `@media print`, logo y
 *    azul de Longchamps, como la OT impresa de CreateWorkOrderModal):
 *      – «como se ve»: la grilla filtrada, con casilleros para tildar a mano y los cortes
 *        de cada línea debajo de la descripción;
 *      – «agrupada por proveedor»: la lista para pedir. Un bloque por proveedor y, dentro,
 *        un renglón por insumo con la cantidad SUMADA de todas las OT y de qué OT sale
 *        cada parte, con sus cortes y su observación («ABR117 · 5,6 Mts · 15692: 3,6 ·
 *        ✂ 3 × 1.093 mm»): es lo que Maxi dicta por teléfono, no una línea por OT. Debajo
 *        del total, los metros que piden los cortes (si todas las partes los tienen).
 *        Es para PEDIR: no entra lo disponible (ya está cortado en la cañera; sumarlo
 *        invitaba a comprarlo otra vez) ni lo que cubre una reserva de stock; de una
 *        reserva parcial, sólo lo que falta. Lo pedido que no llegó sí entra, tildado (si el
 *        insumo mezcla pedido y sin pedir, la parte pedida dice «ya pedido» y debajo del
 *        total va cuánto falta pedir).
 *        Con `soloFalta`, además sin lo pedido: sólo lo que falta conseguir (`falta` > 0).
 *        La hoja dice arriba qué entró y cuántas líneas quedaron afuera y por qué.
 *  · «Exportar» (ExportarMenu): las columnas de la grilla, para Excel/PDF/CSV.
 *
 * Todo sale de las filas que se VEN (con los filtros puestos), en el orden en que se ven.
 */

import { toast } from "@/lib/toast";
import type { ColumnaExport } from "@/lib/exportar";
import { compraCorta, estadoLinea, ESTADOS_LINEA, fmtCantidad, fmtFecha, metrosQueSeMuestran, type LineaPendiente } from "@/lib/materiaPrima";
import { textoCortes } from "./PendientesCortes";

/** Una fila lista para salir: la línea y los casilleros de su OT (los de la cañera de la pantalla). */
export interface FilaSalida {
    linea: LineaPendiente;
    celdas: string[];
    /** Si la cañera no tiene a la OT: los casilleros que dicen sus observaciones («E4»), separados por espacio. */
    coordObs?: string;
}

/** Los casilleros como van al papel: los de la cañera o, si no hay, los de las observaciones aclarados. */
const textoCanera = (f: FilaSalida) =>
    f.celdas.length ? f.celdas.join(" ") : f.coordObs ? `${f.coordObs} (obs.)` : "";

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
    { titulo: "Cortes (mm)", valor: (f) => textoCortes(f.linea.cortes) },
    { titulo: "Metros s/cortes", tipo: "numero", decimales: 2, valor: (f) => metrosQueSeMuestran(f.linea) },
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
    { titulo: "Cañera", valor: textoCanera },
    { titulo: "Recortes", tipo: "entero", valor: (f) => f.linea.recortes_disponibles || null },
    { titulo: "Estado", valor: (f) => ESTADOS_LINEA[estadoLinea(f.linea)].rotulo },
];

const ESTILOS = `
*{box-sizing:border-box}
:root{color-scheme:light}
body{font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;margin:0;font-size:11px}
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
.cortes{font-size:9px;color:#333;margin-top:2px}
.cortes b{color:#5b21b6}
.parte{white-space:normal}
.parte+.parte{margin-top:2px}
.obs{font-style:italic;color:#555}
.incluye{font-size:10px;color:#1e3a5f;background:#f1f5fb;border:1px solid #9fb3cc;border-left:4px solid #1e3a5f;
  padding:5px 8px;margin:0 0 8px}
.incluye b{font-weight:bold}
.pie{margin-top:10px;font-size:9px;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:5px}
@media print{.page{padding:6mm 7mm}th,tr.lista td,tr.esperando td,.incluye{-webkit-print-color-adjust:exact;print-color-adjust:exact}
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
            .map((f) => {
                const l = f.linea;
                const nueva = l.id_orden_trabajo !== otAnterior;
                otAnterior = l.id_orden_trabajo;
                const estado = estadoLinea(l);
                const clases = [nueva ? "ot" : "", estado === "lista" ? "lista" : estado === "esperando" ? "esperando" : ""]
                    .filter(Boolean)
                    .join(" ");
                return `<tr class="${clases}">
<td>${nueva ? `<b>${esc(l.numero_ot)}</b>${l.fecha_requerida ? `<div class="chico">nec. ${esc(fmtFecha(l.fecha_requerida))}</div>` : ""}` : ""}</td>
<td><b>${esc(l.codigo)}</b></td>
<td>${esc(l.descripcion)}${renglonCortes(l)}</td>
<td class="n">${esc(fmtCantidad(l.cantidad))}</td>
<td>${esc(l.unidad ?? "")}</td>
<td>${esc(l.proveedor ?? "")}</td>
<td>${esc(l.observaciones ?? "")}</td>
<td class="c caja">${tilde(l.pedido)}</td>
<td class="c caja">${l.reserva ? `✔<div class="chico">${esc(fmtCantidad(l.cantidad_reservada))}</div>` : ""}</td>
<td class="c caja">${tilde(l.disponible)}</td>
<td class="c caja">${tilde(l.en_produccion || l.ot_en_curso)}</td>
<td class="c">${l.fecha_proveedor ? esc(fmtFecha(l.fecha_proveedor)) : ""}</td>
<td class="n">${esc(fmtCantidad(l.stock_libre))}</td>
<td class="n${l.falta > 0 ? " falta" : ""}">${l.falta > 0 ? esc(fmtCantidad(l.falta)) : ""}</td>
<td class="c">${esc(textoCanera(f))}</td>
</tr>`;
            })
            .join("")
        : `<tr><td colspan="15" class="c" style="color:#999">No hay líneas con estos filtros</td></tr>`;

    abrirVentana(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>${ESTILOS}</style></head><body><div class="page">
${encabezado(titulo, subtitulo)}
${filtros.length ? `<p class="filtros">${filtros.map(esc).join(" · ")}</p>` : ""}
<table><thead><tr>
<th>OT</th><th>Código</th><th>Descripción</th><th class="n">Cant.</th><th>Un.</th><th>Proveedor</th><th>Obs.</th>
<th class="c">Ped.</th><th class="c">Res.</th><th class="c">Disp.</th><th class="c">Prod.</th><th class="c">F. prov.</th><th class="n">Libre</th><th class="n">Falta</th><th class="c">Cañera</th>
</tr></thead><tbody>${cuerpo}</tbody></table>
<div class="pie">${filas.length} línea${filas.length === 1 ? "" : "s"} · Materia prima › Pendientes · SPMM</div>
</div></body></html>`);
}

/** La marca de «compra corta» (la línea en metros pide menos que sus cortes): la misma en las dos hojas. */
const MARCA_CORTA = ' <span class="falta">(pide menos)</span>';

/** Los cortes de la línea, debajo de la descripción: «✂ 3 × 1.093 mm · ≈ 3,29 m». */
function renglonCortes(l: LineaPendiente): string {
    const t = textoCortes(l.cortes);
    if (!t) return "";
    const m = metrosQueSeMuestran(l);
    const metros = m !== null ? ` · ≈ ${esc(fmtCantidad(m))} m${compraCorta(l) ? MARCA_CORTA : ""}` : "";
    return `<div class="cortes"><b>✂</b> ${esc(t)}${metros}</div>`;
}

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * De una línea, lo que no cubre el stock reservado: lo que hay que comprar o, si ya está
 * pedida, lo que se le compró al proveedor. Sin reserva, la cantidad entera. Si no está
 * pedida es lo mismo que `falta`.
 */
const aComprarDe = (l: LineaPendiente) =>
    Math.max(0, redondear3((l.cantidad ?? 0) - (l.reserva ? (l.cantidad_reservada ?? 0) : 0)));

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const normal = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

export interface OpcionesPorProveedor {
    /** Sólo lo que falta conseguir (`falta` > 0), y por la cantidad que falta. */
    soloFalta?: boolean;
}

/**
 * La lista para pedir: por proveedor y, dentro, por insumo, con las cantidades sumadas.
 * Se suma sólo lo que tiene la misma unidad (3 Mts y 2 Un del mismo código no se suman:
 * van en dos renglones). Las líneas sin proveedor van al final, en «Sin proveedor».
 *
 * De cada OT sale su parte con los cortes y la observación de la línea: «Pedir a DANIEL»,
 * «Mercadolibre» o el corte de 1.093 mm es justo lo que hay que decirle al proveedor.
 */
export function imprimirPorProveedor(
    filas: FilaSalida[],
    titulo: string,
    subtitulo: string,
    filtros: string[],
    opciones: OpcionesPorProveedor = {},
) {
    const { soloFalta = false } = opciones;
    type Parte = {
        ot: string;
        cant: number;
        /** La cantidad de la línea, si lo que va es menos (reserva parcial). */
        de: number | null;
        /** Lo que cubre la reserva, si va menos que la línea. */
        reservado: number | null;
        cortes: string;
        metros: number | null;
        /** La línea va en metros y pide menos que sus cortes. */
        corta: boolean;
        obs: string;
        /** Ya se le encargó al proveedor (en un renglón que mezcla, se marca en la parte). */
        pedido: boolean;
    };
    type Renglon = {
        codigo: string;
        descripcion: string;
        unidad: string;
        total: number;
        partes: Parte[];
        fechas: Set<string>;
        /** Todas sus líneas ya están pedidas: sale con la tilde puesta (la lista también sirve para mandarle al proveedor lo que se le encargó). */
        pedido: boolean;
    };
    // Qué entra y qué queda afuera (y por qué, para decirlo arriba de la hoja).
    const afuera = { disponibles: 0, conStock: 0, pedidas: 0 };
    const usadas = filas.filter(({ linea: l }) => {
        if (!l.usado) return false;
        if (l.disponible) {
            afuera.disponibles++;
            return false;
        }
        if (soloFalta && l.pedido) {
            afuera.pedidas++;
            return false;
        }
        if (aComprarDe(l) <= 0) {
            afuera.conStock++;
            return false;
        }
        return true;
    });
    const grupos = new Map<string, { nombre: string; renglones: Map<string, Renglon> }>();
    for (const { linea: l } of usadas) {
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
        // Lo que no cubre la reserva (con una reserva parcial, menos que la línea). Sin
        // pedir, es `falta`; pedida, lo que se le encargó al proveedor.
        const cant = aComprarDe(l);
        const parcial = cant < l.cantidad;
        r.total += cant;
        r.partes.push({
            ot: String(l.numero_ot ?? "—"),
            cant,
            de: parcial ? l.cantidad : null,
            reservado: parcial && l.reserva ? (l.cantidad_reservada ?? 0) : null,
            cortes: textoCortes(l.cortes),
            metros: metrosQueSeMuestran(l),
            corta: compraCorta(l),
            obs: (l.observaciones ?? "").trim(),
            pedido: l.pedido,
        });
        if (l.fecha_requerida) r.fechas.add(l.fecha_requerida);
        if (!l.pedido) r.pedido = false;
    }
    const ordenados = [...grupos.entries()].sort(([a, ga], [b, gb]) =>
        a === "~" ? 1 : b === "~" ? -1 : ga.nombre.localeCompare(gb.nombre, "es"),
    );

    /**
     * Una parte. En un renglón que mezcla lo pedido con lo que falta (la tilde de «Ped.»
     * queda vacía), la parte pedida dice «ya pedido»: si no, el total invitaba a volver a
     * encargar lo que ya se le encargó al proveedor.
     */
    const parteHtml = (p: Parte, mezcla: boolean) => {
        const de =
            p.de !== null
                ? ` <span class="chico">(de ${esc(fmtCantidad(p.de))}${p.reservado ? `, ${esc(fmtCantidad(p.reservado))} de stock` : ""})</span>`
                : "";
        const cant = `${esc(fmtCantidad(p.cant))}${de}`;
        const cortes = p.cortes
            ? ` · <b>✂</b> ${esc(p.cortes)}${p.metros !== null ? ` <span class="chico">(≈ ${esc(fmtCantidad(p.metros))} m)</span>` : ""}${p.corta ? MARCA_CORTA : ""}`
            : "";
        const obs = p.obs ? ` · <span class="obs">${esc(p.obs)}</span>` : "";
        const yaPedido = mezcla && p.pedido ? ' <b class="chico">✔ ya pedido</b>' : "";
        return `<div class="parte"><b>${esc(p.ot)}</b>: ${cant}${yaPedido}${cortes}${obs}</div>`;
    };
    /**
     * Los metros de los cortes de todas las partes, si todas los tienen (si falta uno, la
     * suma engaña). Tampoco con una reserva parcial: los metros son de la línea entera y
     * el total no cuenta lo del stock («Falta 5» al lado de «cortes ≈ 5,48 m»).
     */
    const metrosDe = (r: Renglon) =>
        r.partes.length && r.partes.every((p) => p.metros !== null && p.de === null)
            ? Math.round(r.partes.reduce((s, p) => s + (p.metros ?? 0), 0) * 100) / 100
            : null;

    const bloques = ordenados.length
        ? ordenados
            .map(([, g]) => {
                const renglones = [...g.renglones.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, "es"));
                const filasHtml = renglones
                    .map((r) => {
                        const primera = [...r.fechas].sort()[0];
                        const metros = metrosDe(r);
                        const corta = r.partes.some((p) => p.corta);
                        const yaPedido = r.pedido ? 0 : redondear3(r.partes.reduce((s, p) => s + (p.pedido ? p.cant : 0), 0));
                        const debajo = [
                            yaPedido > 0
                                ? `<div class="chico">falta pedir ${esc(fmtCantidad(redondear3(r.total - yaPedido)))} · ${esc(fmtCantidad(yaPedido))} ya pedido</div>`
                                : "",
                            metros !== null
                                ? `<div class="chico${corta ? " falta" : ""}">cortes ≈ ${esc(fmtCantidad(metros))} m${corta ? " ⚠" : ""}</div>`
                                : corta
                                    ? '<div class="chico falta">⚠ pide menos que los cortes</div>'
                                    : "",
                        ].join("");
                        return `<tr>
<td class="c caja">${r.pedido ? "✔" : ""}</td>
<td><b>${esc(r.codigo)}</b></td>
<td>${esc(r.descripcion)}</td>
<td class="n"><b>${esc(fmtCantidad(redondear3(r.total)))}</b>${debajo}</td>
<td>${esc(r.unidad)}</td>
<td class="chico">${r.partes.map((p) => parteHtml(p, yaPedido > 0)).join("")}</td>
<td class="c">${primera ? esc(fmtFecha(primera)) : ""}</td>
</tr>`;
                    })
                    .join("");
                return `<h2>${esc(g.nombre)} <span>${renglones.length} insumo${renglones.length === 1 ? "" : "s"}</span></h2>
<table><thead><tr><th class="c" title="Tildado = ya pedido">Ped.</th><th>Código</th><th>Descripción</th><th class="n">${soloFalta ? "Falta" : "A pedir"}</th><th>Un.</th><th>OT: cantidad · cortes · obs.</th><th class="c">Se necesita</th></tr></thead>
<tbody>${filasHtml}</tbody></table>`;
            })
            .join("")
        : `<p style="color:#999;text-align:center">${soloFalta ? "No falta pedir nada de lo que se ve" : "No hay nada para pedir en lo que se ve"}</p>`;

    // Arriba de todo, qué entró y qué no: la hoja anda suelta por el taller.
    const incluye = soloFalta
        ? "<b>Incluye sólo lo que falta pedir</b>: ni pedido, ni disponible, ni cubierto con stock reservado. De una reserva parcial, sólo lo que falta."
        : "<b>Incluye lo que falta pedir y lo pedido que todavía no llegó</b> (tildado en «Ped.», o «ya pedido» en su OT si el insumo mezcla las dos cosas). De una reserva parcial, sólo lo que falta. No incluye lo disponible (ya está cortado en la cañera) ni lo cubierto con stock reservado.";
    const quedaron = [
        afuera.pedidas ? plural(afuera.pedidas, "pedida", "pedidas") : "",
        afuera.disponibles ? plural(afuera.disponibles, "disponible", "disponibles") : "",
        afuera.conStock ? `${plural(afuera.conStock, "cubierta", "cubiertas")} con stock` : "",
    ].filter(Boolean);
    const cuadroIncluye = `<p class="incluye">${incluye}${
        quedaron.length ? `<br>Quedaron afuera ${plural(afuera.pedidas + afuera.disponibles + afuera.conStock, "línea", "líneas")} de las que se ven: ${esc(quedaron.join(", "))}.` : ""
    }</p>`;

    abrirVentana(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>${ESTILOS}</style></head><body><div class="page">
${encabezado(titulo, subtitulo)}
${cuadroIncluye}
${filtros.length ? `<p class="filtros">${filtros.map(esc).join(" · ")}</p>` : ""}
${bloques}
<div class="pie">${esc(titulo)} · ${usadas.length} línea${usadas.length === 1 ? "" : "s"} de OT · Materia prima › Pendientes · SPMM</div>
</div></body></html>`);
}
