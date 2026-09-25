"use client";

/**
 * Lo que se consumió de cada material de una OT (RF-15).
 *
 * La solapa Materias primas de la ficha muestra lo que la OT PIDE. Desde el 23/09 eso
 * se carga en SPMM (la solapa es editable y Maxi lo compra desde Materia prima ›
 * Pendientes); durante la prueba piloto de fines de septiembre se sigue cargando en el
 * Sistema Integral y acá se ve en espejo, sólo lectura (ver MateriasPrimasOT). Lo que se
 * CONSUME, en cambio, es de SPMM en los dos casos: va a una tabla propia que el sync no
 * mira, y se carga desde la misma fila del material, sin salir de la ficha.
 *
 * TRES REGLAS
 *
 *  · Se ve al toque. Registrar suma en la fila antes de que conteste el servidor; si el
 *    servidor dice que no, el renglón se va, el número vuelve y lo tipeado vuelve al
 *    campo. Nada de recargar ni de spinner tapando la lista.
 *  · No se borra, se anula. El renglón equivocado queda tachado, con quién y cuándo.
 *  · Si el backend todavía no tiene la ruta (se deploya a mano y puede ir atrás del
 *    front), la columna no aparece y la solapa queda exactamente como antes.
 *
 * No mueve el stock, y no por falta de dueño: el stock ya es de SPMM (la suma de los
 * movimientos del insumo), pero el material de una OT se compra JUSTO para esa OT y no
 * pasa por el depósito. Lo único que la OT saca del depósito es lo que reservó, y sale
 * una vez, cuando su línea se marca «Disponible» (el retiro del backend). Descontar
 * también acá restaría algo que nunca entró, o lo reservado dos veces. Esto registra lo
 * que se usó; el stock lo mueven los movimientos. (Mismo criterio que el backend:
 * ConsumoMaterialService.)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronUp, Plus, Undo2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { frenarPorPractica } from "@/lib/materiaPrima";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_URL } from "@/config";
import { decodeJwt } from "@/lib/jwt";
import { capitalizeName, cn, parseApiError } from "@/lib/utils";
import { usePermisos } from "@/hooks/usePermisos";

export interface ConsumoMaterial {
    id: number;
    id_orden_trabajo: number;
    id_orden_trabajo_pieza: number | null;
    id_pieza: number;
    cod_pieza: string | null;
    descripcion: string | null;
    cantidad: number;
    unidad: string | null;
    /** Hora del taller, sin zona: `new Date()` la lee como hora local. */
    fecha: string;
    id_usuario: number | null;
    usuario: string | null;
    observaciones: string | null;
    anulado: boolean;
    anulado_en: string | null;
    anulado_por: string | null;
    motivo_anulacion: string | null;
    /** Sólo del navegador: se dibujó antes de que contestara el servidor. */
    pendiente?: boolean;
}

/** Qué se le puede consumir: una fila de la solapa, o sea una línea de la OT. */
export interface LineaDeMaterial {
    idLinea: number;
    codigo: string;
    descripcion: string;
    /** Lo que pide la línea (su cantidad), para comparar con lo consumido. */
    pedido: number;
    unidad: string;
}

/**
 * «no» = este backend no tiene la ruta: la columna ni aparece. «error» = la tiene pero
 * no pudo contestar (por ejemplo, la tabla todavía no se creó): tampoco aparece, pero se
 * avisa en una línea para que no parezca que no hay nada cargado.
 */
export type EstadoConsumos = "cargando" | "si" | "no" | "error";

const cabeceras = (json = false): HeadersInit => {
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    if (typeof window === "undefined") return h;
    const token = localStorage.getItem("access_token");
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
};

/**
 * Quién soy, del token. Se lee del mismo lugar que mira el backend para decidir quién
 * puede anular, y no de AuthContext: la ficha no tiene por qué depender de que el
 * contexto de sesión esté montado para dibujar una tabla.
 */
function yo(): { id: number | null; nombre: string | null; admin: boolean } {
    if (typeof window === "undefined") return { id: null, nombre: null, admin: false };
    const token = localStorage.getItem("access_token");
    const p = token ? decodeJwt(token) : null;
    const nombre = [p?.nombre, p?.apellido].filter(Boolean).join(" ").trim() || p?.sub || null;
    return {
        id: typeof p?.id_usuario === "number" ? p.id_usuario : null,
        nombre: nombre ? String(nombre) : null,
        admin: p?.rol === "admin",
    };
}

/** «2,5» y «2.5» son lo mismo para el que carga. «1.234,5» también se entiende. */
export function leerCantidad(texto: string): number | null {
    const t = texto.trim().replace(/\s/g, "");
    if (!t) return null;
    const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
    const n = Number(normal);
    return Number.isFinite(n) ? n : null;
}

export const fmtCantidad = (n: number) =>
    n.toLocaleString("es-AR", { maximumFractionDigits: 3 });

// Reloj de 24 h, como en Auditoría: «12:10 p. m.» parte el renglón en un teléfono.
const fmtMomento = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
};

/** La hora de este navegador escrita como las de la base: local y sin zona. */
function ahoraLocal(): string {
    const d = new Date();
    const dos = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

const redondear = (n: number) => Math.round(n * 1000) / 1000;

// Ids de los renglones que todavía no contestó el servidor. Negativos para que nunca
// choquen con uno real, y de un contador y no de la hora: dos cargas en el mismo
// milisegundo (un doble toque) tendrían el mismo id y se pisarían.
let proximoTemporal = -1;

/**
 * Los consumos de una OT y cómo cargarlos o anularlos.
 *
 * `activo` es para no pedir nada con la ficha cerrada: el modal queda montado.
 */
export function useConsumosDeOrden(idOrden: number | undefined, activo: boolean) {
    const [consumos, setConsumos] = useState<ConsumoMaterial[]>([]);
    const [estado, setEstado] = useState<EstadoConsumos>("cargando");
    // Lo último dibujado, para saber cómo estaba un renglón antes de anularlo y poder
    // devolverlo tal cual si el servidor dice que no.
    const ultimos = useRef<ConsumoMaterial[]>([]);
    useEffect(() => {
        ultimos.current = consumos;
    }, [consumos]);

    useEffect(() => {
        setConsumos([]);
        if (!activo || !idOrden) {
            setEstado("no");
            return;
        }
        let vigente = true;
        setEstado("cargando");
        fetch(`${API_URL}/consumos-material?id_orden_trabajo=${idOrden}`, { headers: cabeceras() })
            .then(async (res) => {
                if (!vigente) return;
                // 404/405: backend de antes del RF-15. 401/403: sin sesión válida, y de eso
                // ya se encarga el resto de la app. En los dos casos, como si no existiera.
                if ([401, 403, 404, 405].includes(res.status)) {
                    setEstado("no");
                    return;
                }
                if (!res.ok) {
                    setEstado("error");
                    return;
                }
                const body = await res.json().catch(() => null);
                if (!vigente) return;
                if (!body?.status || !Array.isArray(body.data)) {
                    setEstado("error");
                    return;
                }
                setConsumos(body.data as ConsumoMaterial[]);
                setEstado("si");
            })
            .catch(() => {
                if (vigente) setEstado("error");
            });
        return () => {
            vigente = false;
        };
    }, [idOrden, activo]);

    /** Total vigente (sin anulados) por línea. Los pendientes ya suman: se ve al toque. */
    const totalPorLinea = useMemo(() => {
        const m = new Map<number, number>();
        for (const c of consumos) {
            if (c.anulado || c.id_orden_trabajo_pieza == null) continue;
            m.set(c.id_orden_trabajo_pieza, redondear((m.get(c.id_orden_trabajo_pieza) ?? 0) + Number(c.cantidad)));
        }
        return m;
    }, [consumos]);

    const anular = useCallback(async (id: number): Promise<boolean> => {
        const antes = ultimos.current.find((c) => c.id === id);
        // Un doble toque en «Anular» no manda dos pedidos.
        if (antes?.anulado) return true;
        // Modo práctica (prueba piloto): el cartel dice «no se guarda nada», y el consumo
        // no pasa por el candado de mpFetch (va directo a /consumos-material). Se frena
        // acá, antes de tocar la lista, para que lo que se ve siga siendo lo guardado.
        if (frenarPorPractica()) return false;
        if (antes) {
            const quien = yo();
            setConsumos((prev) => prev.map((c) => (c.id === id
                ? { ...c, anulado: true, anulado_en: ahoraLocal(), anulado_por: quien.nombre }
                : c)));
        }
        try {
            const res = await fetch(`${API_URL}/consumos-material/${id}/anular`, {
                method: "PUT",
                headers: cabeceras(true),
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                const motivo = parseApiError(await res.text());
                throw new Error(motivo || `El servidor contestó ${res.status}`);
            }
            const body = await res.json().catch(() => null);
            if (body?.data) setConsumos((prev) => prev.map((c) => (c.id === id ? body.data : c)));
            toast.success("Consumo anulado", { description: "Deja de sumar y queda tachado en la lista." });
            return true;
        } catch (e) {
            if (antes) setConsumos((prev) => prev.map((c) => (c.id === id ? antes : c)));
            toast.error("No se pudo anular el consumo", {
                description: e instanceof Error ? e.message : undefined,
            });
            return false;
        }
    }, []);

    const registrar = useCallback(async (
        linea: LineaDeMaterial, cantidad: number, observaciones: string,
    ): Promise<boolean> => {
        if (!idOrden) return false;
        // Modo práctica: ver `anular`. Devuelve false y el formulario queda con lo cargado.
        if (frenarPorPractica()) return false;
        const quien = yo();
        const temporal: ConsumoMaterial = {
            id: proximoTemporal--,
            id_orden_trabajo: idOrden,
            id_orden_trabajo_pieza: linea.idLinea,
            id_pieza: 0,
            cod_pieza: linea.codigo,
            descripcion: linea.descripcion,
            cantidad: redondear(cantidad),
            unidad: linea.unidad,
            fecha: ahoraLocal(),
            id_usuario: quien.id,
            usuario: quien.nombre,
            observaciones: observaciones.trim() || null,
            anulado: false,
            anulado_en: null,
            anulado_por: null,
            motivo_anulacion: null,
            pendiente: true,
        };
        setConsumos((prev) => [temporal, ...prev]);
        try {
            const res = await fetch(`${API_URL}/consumos-material`, {
                method: "POST",
                headers: cabeceras(true),
                body: JSON.stringify({
                    id_orden_trabajo: idOrden,
                    id_orden_trabajo_pieza: linea.idLinea,
                    cantidad: redondear(cantidad),
                    observaciones: observaciones.trim() || null,
                }),
            });
            if (!res.ok) {
                const motivo = parseApiError(await res.text());
                throw new Error(motivo || `El servidor contestó ${res.status}`);
            }
            const body = await res.json();
            const guardado = body?.data as ConsumoMaterial | undefined;
            if (!guardado || typeof guardado.id !== "number") throw new Error("Respuesta inesperada del servidor");
            setConsumos((prev) => prev.map((c) => (c.id === temporal.id ? guardado : c)));
            // Sin botón «Deshacer» en el aviso a propósito: la ficha es un diálogo modal y
            // Radix le saca los clics a todo lo que está afuera, avisos incluidos. El botón
            // se veía y no andaba. El deshacer es el «Anular» del renglón, que está ahí.
            toast.success("Consumo registrado", {
                description: `${fmtCantidad(guardado.cantidad)} ${guardado.unidad ?? ""} de ${linea.codigo}. Si fue un error, tocá «Anular» en el renglón.`,
            });
            return true;
        } catch (e) {
            setConsumos((prev) => prev.filter((c) => c.id !== temporal.id));
            toast.error("No se registró el consumo", {
                description: e instanceof Error ? e.message : undefined,
            });
            return false;
        }
    }, [idOrden]);

    /** Lo anula quien lo cargó o un admin: la misma regla que aplica el backend. */
    const puedeAnular = useCallback((c: ConsumoMaterial) => {
        if (c.pendiente || c.anulado) return false;
        const quien = yo();
        return quien.admin || (c.id_usuario != null && c.id_usuario === quien.id);
    }, []);

    return { estado, consumos, totalPorLinea, registrar, anular, puedeAnular };
}

/** La celda «Consumido» de una fila: el total, y el botón que abre el detalle. */
export function CeldaConsumido({ linea, total, abierto, onAlternar }: {
    linea: LineaDeMaterial;
    total: number;
    abierto: boolean;
    onAlternar: () => void;
}) {
    const excede = linea.pedido > 0 && total > linea.pedido;
    return (
        <button
            type="button"
            onClick={onAlternar}
            aria-expanded={abierto}
            aria-label={`Consumido de ${linea.codigo}: ${total > 0 ? `${fmtCantidad(total)} ${linea.unidad}` : "nada"}. Tocá para registrar o ver el detalle.`}
            title={excede
                ? `Se consumió más de lo pedido (${fmtCantidad(linea.pedido)} ${linea.unidad})`
                : "Registrar consumo o ver el detalle"}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                abierto ? "border-blue-300 bg-blue-50" : "border-transparent hover:border-blue-200 hover:bg-blue-50/60",
            )}
        >
            <span className={cn(
                "tabular-nums font-semibold",
                total <= 0 ? "text-gray-400" : excede ? "text-amber-700" : "text-gray-900",
            )}>
                {total > 0 ? fmtCantidad(total) : "—"}
            </span>
            {abierto
                ? <ChevronUp className="h-3.5 w-3.5 text-blue-600" aria-hidden />
                : <Plus className="h-3.5 w-3.5 text-blue-600" aria-hidden />}
        </button>
    );
}

/** Un consumo en la lista: tachado si se anuló, con quién y cuándo. */
function Renglon({ c, puedeAnular, onAnular, mostrarMaterial }: {
    c: ConsumoMaterial;
    puedeAnular: boolean;
    onAnular: () => void;
    mostrarMaterial?: boolean;
}) {
    const quien = c.usuario ? capitalizeName(c.usuario) : "sin registrar";
    return (
        <li className="flex items-start justify-between gap-2 py-1.5">
            <div className="min-w-0 text-xs">
                <p className={cn("text-gray-700", c.anulado && "text-gray-400 line-through")}>
                    {mostrarMaterial && (
                        <span className="font-medium" title={c.descripcion ?? undefined}>
                            {c.cod_pieza || `Pieza ${c.id_pieza}`}{" · "}
                        </span>
                    )}
                    <span className="font-semibold tabular-nums">
                        {fmtCantidad(Number(c.cantidad))} {c.unidad ?? ""}
                    </span>
                    {" · "}{quien}
                    {" · "}{c.pendiente ? "guardando…" : fmtMomento(c.fecha)}
                </p>
                {c.observaciones && (
                    <p className={cn("break-words text-gray-500", c.anulado && "line-through")}>{c.observaciones}</p>
                )}
                {c.anulado && (
                    <p className="text-[11px] text-gray-500">
                        Anulado{c.anulado_por ? ` por ${capitalizeName(c.anulado_por)}` : ""}
                        {c.anulado_en ? ` el ${fmtMomento(c.anulado_en)}` : ""}
                        {c.motivo_anulacion ? ` — ${c.motivo_anulacion}` : ""}
                    </p>
                )}
            </div>
            {puedeAnular && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onAnular}
                    className="h-7 shrink-0 px-2 text-xs text-gray-500 hover:text-red-600"
                    title="Deja de sumar, pero queda a la vista tachado"
                >
                    <Undo2 className="h-3.5 w-3.5" aria-hidden />
                    Anular
                </Button>
            )}
        </li>
    );
}

export function ListaDeConsumos({ consumos, puedeAnular, onAnular, vacio, mostrarMaterial }: {
    consumos: ConsumoMaterial[];
    puedeAnular: (c: ConsumoMaterial) => boolean;
    onAnular: (id: number) => void;
    vacio?: string;
    /** Cuando la lista mezcla materiales (los que no están en la lista de la OT). */
    mostrarMaterial?: boolean;
}) {
    if (consumos.length === 0) {
        return vacio ? <p className="text-xs text-gray-400">{vacio}</p> : null;
    }
    return (
        <ul className="divide-y divide-gray-100">
            {consumos.map((c) => (
                <Renglon
                    key={c.id}
                    c={c}
                    puedeAnular={puedeAnular(c)}
                    onAnular={() => onAnular(c.id)}
                    mostrarMaterial={mostrarMaterial}
                />
            ))}
        </ul>
    );
}

/**
 * La fila que se abre debajo del material: el alta en línea y lo ya cargado.
 *
 * El contenido va `sticky left-0` y con el ancho de lo que se ve: la tabla es más ancha
 * que un teléfono y se desplaza de costado, pero el formulario tiene que quedar a la
 * vista sin tener que ir a buscarlo. «Lo que se ve» es el ancho del contenedor que
 * desplaza (`100cqw`): por eso ese contenedor tiene que llevar la clase `@container`.
 * Con `vw` no daba: la ficha no ocupa todo el ancho y el botón quedaba cortado. Los botones son `type="button"` y el Enter se
 * ataja: todo esto vive adentro del <form> de la OT, y un Enter suelto la guardaría.
 */
export function FilaDeConsumo({ linea, colSpan, consumos, total, onRegistrar, puedeAnular, onAnular }: {
    linea: LineaDeMaterial;
    colSpan: number;
    consumos: ConsumoMaterial[];
    total: number;
    onRegistrar: (cantidad: number, observaciones: string) => Promise<boolean>;
    puedeAnular: (c: ConsumoMaterial) => boolean;
    onAnular: (id: number) => void;
}) {
    const [cantidad, setCantidad] = useState("");
    const [obs, setObs] = useState("");
    const [error, setError] = useState<string | null>(null);
    // RF-24: registrar o anular un consumo es tocar la OT (solapa Órdenes en escritura,
    // como pide el backend). Con lectura sola se ve lo consumido, sin el formulario.
    const { puedeSeccion } = usePermisos();
    const puedeRegistrar = puedeSeccion("operaciones_ordenes", "write");

    const enviar = async () => {
        const n = leerCantidad(cantidad);
        if (n === null || redondear(n) <= 0) {
            setError("Poné cuánto se consumió: un número mayor a 0.");
            return;
        }
        setError(null);
        // Se limpia ya: el renglón aparece al toque en la lista. Si el servidor dice que
        // no, lo tipeado vuelve al campo para no tener que escribirlo de nuevo.
        const antes = { cantidad, obs };
        setCantidad("");
        setObs("");
        const ok = await onRegistrar(n, obs);
        if (!ok) {
            setCantidad(antes.cantidad);
            setObs(antes.obs);
        }
    };

    const alEnter = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void enviar();
        }
    };

    const excede = linea.pedido > 0 && total > linea.pedido;

    return (
        <tr className="bg-blue-50/30">
            <td colSpan={colSpan} className="p-0">
                <div className="sticky left-0 w-[min(40rem,100cqw)] space-y-2.5 px-3 py-3">
                    <p className="text-xs text-gray-600">
                        <span className="font-semibold text-gray-800">{linea.codigo}</span>
                        {" · "}Pedido {fmtCantidad(linea.pedido)} {linea.unidad}
                        {" · "}Consumido{" "}
                        <span className={cn("font-semibold tabular-nums", excede ? "text-amber-700" : "text-gray-800")}>
                            {fmtCantidad(total)} {linea.unidad}
                        </span>
                        {excede && <span className="text-amber-700"> (más de lo pedido)</span>}
                    </p>

                    {puedeRegistrar && <div className="flex flex-wrap items-end gap-2">
                        <label className="w-28 space-y-1">
                            <span className="block text-[11px] font-medium text-gray-500">Cantidad ({linea.unidad || "—"})</span>
                            <Input
                                inputMode="decimal"
                                autoComplete="off"
                                placeholder="0"
                                value={cantidad}
                                onChange={(e) => { setCantidad(e.target.value); if (error) setError(null); }}
                                onKeyDown={alEnter}
                                aria-invalid={!!error}
                                className="h-9 bg-white text-base tabular-nums sm:text-sm"
                            />
                        </label>
                        <label className="min-w-[10rem] flex-1 space-y-1">
                            <span className="block text-[11px] font-medium text-gray-500">Observación (opcional)</span>
                            <Input
                                autoComplete="off"
                                placeholder="Ej.: segundo corte"
                                maxLength={1000}
                                value={obs}
                                onChange={(e) => setObs(e.target.value)}
                                onKeyDown={alEnter}
                                className="h-9 bg-white text-base sm:text-sm"
                            />
                        </label>
                        <Button type="button" size="sm" className="h-9" onClick={() => void enviar()}>
                            <Plus className="h-4 w-4" aria-hidden />
                            Registrar
                        </Button>
                    </div>}
                    {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

                    <ListaDeConsumos
                        consumos={consumos}
                        puedeAnular={(c) => puedeRegistrar && puedeAnular(c)}
                        onAnular={onAnular}
                        vacio="Todavía no se registró consumo de este material."
                    />
                </div>
            </td>
        </tr>
    );
}
