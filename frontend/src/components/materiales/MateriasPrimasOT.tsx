"use client";

/**
 * La solapa «Materias primas» de la OT (spec §3.4), EDITABLE.
 *
 * Hasta el 23/09/2026 esta solapa se miraba y no se tocaba: las materias primas se
 * cargaban en el sistema viejo y el sync las traía. En la reunión de ese día con Lucas se
 * decidió que la gestión pasa a SPMM: Carolina carga la OT, el plano y sus materias
 * primas acá; Maxi las compra desde Pendientes (Materia prima › Pendientes). Esta
 * solapa es donde se cargan y donde se ve cómo va cada una.
 *
 * DOS MODOS
 *
 *  · OT EXISTENTE (`idOrden` con número): cada cambio se guarda solo, optimista y con
 *    reversión (`/materia-prima/ot/{id}/lineas`, `/materia-prima/lineas/{id}`…). No hay
 *    nada que «guardar» al cerrar el modal.
 *
 *  · OT NUEVA (`idOrden = null`, modo local): la OT todavía no existe y las líneas no se
 *    pueden mandar. Se arman en memoria y las tiene EL MODAL (`lineasLocales` +
 *    `onLineasLocalesChange`, controlado): apenas `POST /ordenes` devuelve el id, el
 *    modal las manda con `mandarLineasDeOTNueva` (MateriasPrimasOTDatos.tsx), que usa
 *    `POST /materia-prima/ot/{id}/lineas/lote`. Si el lote falla, la OT ya quedó creada:
 *    se avisa con el motivo y las líneas quedan guardadas en el navegador, atadas a esa
 *    OT: al abrirla, esta solapa ofrece «Reintentar» o «Descartar». En modo local no hay
 *    marcas (pedido, reserva, disponible…), ni consumo: todo eso es de una línea que
 *    existe en la base.
 *
 * EL «DESCARTAR CAMBIOS» DEL MODAL
 *
 *  · OT nueva: las `lineasLocales` son cambios sin guardar; entran en la huella del
 *    formulario (huellaDelFormulario).
 *  · OT existente: lo que se guardó solo NO es un cambio pendiente. Lo único pendiente es
 *    lo que quedó a medio escribir en la barra de carga (un insumo elegido y no
 *    agregado) o un guardado todavía en vuelo: eso avisa `onSinGuardarChange(true)`.
 *
 * LA CASILLA «NO LLEVA MATERIAS PRIMAS»
 *
 * Vive en el pie de esta solapa (`noLleva` / `onNoLlevaChange`) y el valor lo sigue
 * teniendo el modal en `generalData.no_lleva_materia_prima`, porque `PUT /ordenes/{id}`
 * y `POST /ordenes` lo mandan: si el modal no se enterara, al guardar la OT pisaría lo
 * que se marcó acá con el valor viejo.
 *  · OT nueva: sólo avisa (`onNoLlevaChange`); viaja con el alta de la OT.
 *  · OT existente: lo guarda con `PUT /materia-prima/ot/{id}/no-lleva` y, si salió bien,
 *    avisa. El modal actualiza `generalData` Y su foto inicial (ya está guardado: no es
 *    un cambio para descartar).
 *
 * PERMISOS (RF-24)
 *
 * Escribir acá es escribir Materia prima (`operaciones_materia_prima` en «editar»: lo
 * pide el backend en cada ruta de `/materia-prima/...`), NO la OT. Por eso `edita` no
 * sale del «sólo lectura» del modal (que es la solapa Órdenes): el que compra puede
 * marcar el material de una OT que sólo puede mirar. En una OT NUEVA hacen falta las dos
 * cosas (crear la OT y cargarle material): eso lo resuelve el modal al pasar `edita`.
 * Sin permiso de LEER Materia prima (`puedeVer = false`) no se pide nada: el backend
 * contestaría 403 y saldría el aviso general de «no tenés permiso».
 *
 * PRUEBA PILOTO (MODO ESPEJO, 24/09; MODO PRÁCTICA, 25/09)
 *
 * Mientras el dueño de las materias primas sea el Sistema Integral (`dueno` de los
 * catálogos, ver app/materia-prima/_components/ModoEspejo.tsx), esta solapa MUESTRA lo
 * que se cargó allá, con sus marcas reales, y no GUARDA nada. Arriba va el cartel que lo
 * explica y, con la OT abierta, las líneas se vuelven a pedir solas.
 *  · Quien no puede escribir Materia prima la ve en sólo lectura.
 *  · Quien puede, desde el 25/09 la usa entera en MODO PRÁCTICA (pedido de Julián: ver
 *    cómo es la carga): barra de carga, celdas, casillas, cortes, historial, «No lleva»…
 *    Cada guardado lo frena el candado de `mpFetch` y sale el cartelito «Esto no se
 *    guarda»; lo tocado vuelve a su lugar y la barra y los diálogos quedan con lo cargado.
 *    En una OT NUEVA las líneas se arman igual en memoria, pero al crear la OT no se
 *    mandan (ver `mandarLineasDeOTNueva`).
 * Lo único que sigue igual es el CONSUMO (RF-15): no es de las materias primas del
 * Integral sino un registro propio de SPMM (ver ConsumoDeMaterial.tsx), y ya se cargaba
 * así cuando la lista venía del sistema viejo.
 *
 * LO DEMÁS
 *
 *  · `activo`: la solapa (o el modal) está a la vista. Con false no pide nada.
 *  · `numeroOT`: el número que ve la gente (id_otvieja), para «Ver en Pendientes»
 *    (`/materia-prima?ot=N`) y los textos.
 *  · `unidadesOT`, `idArticulo`: lo que usa «Traer historial» (la OT más reciente del
 *    mismo artículo, escalada por unidades). Se usan los que están EN PANTALLA (la ruta
 *    por artículo `GET /materia-prima/historial`), también en una OT existente: si
 *    cambiaron el producto o la cantidad en General y todavía no guardaron, el historial
 *    tiene que ser el del producto que ven, no el guardado. Sin artículo, en una OT
 *    existente se usa la ruta por id.
 *  · `onLineasChange`: OT existente, las líneas como quedaron después de cada carga
 *    («carga») o cambio («cambio»). La exportación y la hoja del pañol del modal las leen
 *    de ahí, y el modal sabe si tiene que refrescar la columna Material al cerrar.
 *  · `consumo`: si el modal ya pidió los consumos (`useConsumosDeOrden`), que los pase y
 *    no se piden dos veces; si no viene, los pide el componente.
 */

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { AlertTriangle, Boxes, ExternalLink, Info, Layers, Lock, MapPin, RotateCcw } from "lucide-react";
import { API_URL } from "@/config";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import {
    consulta,
    fmtPrecio,
    frenarPorPractica,
    mpGet,
    UNIDADES_LINEA,
    type CorteIn,
    type HistorialOT,
    type Linea,
    type LineaHistorial,
    type LineaIn,
    type LineaLocal,
} from "@/lib/materiaPrima";
import { MarcaSoloLectura } from "@/components/permisos/SinAcceso";
import {
    FilaDeConsumo,
    ListaDeConsumos,
    useConsumosDeOrden,
} from "@/components/materiales/ConsumoDeMaterial";
import { useConfirmarForzar } from "@/app/materia-prima/_components/PendientesForzar";
import { useCatalogosMP } from "@/app/materia-prima/_components/InsumoCatalogos";
import { CartelError, CartelSinServidor, Esqueleto } from "@/app/materia-prima/_components/InsumoComun";
import { CartelEspejo, MarcaEspejo, useDuenoMP, useModoMP, useRefrescoEspejo } from "@/app/materia-prima/_components/ModoEspejo";
import {
    cambiarLineaLocal,
    filaDeLinea,
    filaDeLocal,
    leerSinGuardar,
    lineaLocal,
    lineaTemporal,
    olvidarSinGuardar,
    sugerenciaMetros,
    useLineasDeOT,
    type CambiosFila,
    type FilaMP,
    type LineaLocalMP,
} from "./MateriasPrimasOTDatos";
import { columnasDeLaTabla, FilaMPOT, Th, type AccionesFilaMP } from "./MateriasPrimasOTFila";
import { BarraDeCarga, type CargaDeLinea } from "./MateriasPrimasOTBarra";
import { DialogoCortes, DialogoHistorial } from "./MateriasPrimasOTDialogos";

export interface MateriasPrimasOTProps {
    /** Id interno de la OT. `null` = OT nueva todavía sin id: modo local. */
    idOrden: number | null;
    /** Puede escribir `operaciones_materia_prima` (en una OT nueva, además, crear la OT). */
    edita: boolean;
    /** Puede leer `operaciones_materia_prima`. Con false no se pide nada. Por defecto, true. */
    puedeVer?: boolean;
    /** La solapa está a la vista. Por defecto, true. */
    activo?: boolean;
    /** El número que ve la gente (id_otvieja). */
    numeroOT?: number | null;
    /** Las unidades de la OT (la «Cantidad» de la solapa General). */
    unidadesOT?: number | null;
    /** El artículo (producto) de la OT. */
    idArticulo?: number | null;

    /** Modo local: las líneas que se van a crear con la OT. Controlado por el modal. */
    lineasLocales?: LineaLocal[];
    onLineasLocalesChange?: (lineas: LineaLocal[]) => void;

    /** La casilla «No lleva materias primas». */
    noLleva?: boolean;
    onNoLlevaChange?: (noLleva: boolean) => void;

    /**
     * OT existente: las líneas tal como quedaron. `motivo` = «carga» (llegaron del
     * servidor) o «cambio» (alguien tocó algo en esta apertura).
     */
    onLineasChange?: (lineas: Linea[], motivo: "carga" | "cambio") => void;
    /** Queda algo sin guardar (barra de carga a medio llenar, guardado en vuelo). */
    onSinGuardarChange?: (sinGuardar: boolean) => void;
    /** Los consumos que ya pidió el modal, para no pedirlos dos veces. */
    consumo?: ReturnType<typeof useConsumosDeOrden>;
}

const SIN_LECTURA =
    "No tenés acceso a la sección Materia prima: las materias primas de esta OT no se pueden ver desde tu usuario. Si lo necesitás, pedíselo a un administrador.";

/**
 * Sin permiso de leer Materia prima no se monta nada de adentro: ni las líneas, ni los
 * catálogos, ni los consumos. Cada uno de esos pedidos volvería 403 y dispararía el aviso
 * general de «no tenés permiso» con sólo abrir la OT.
 */
export function MateriasPrimasOT(props: MateriasPrimasOTProps) {
    if (props.puedeVer === false) {
        return (
            <div className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <p>{SIN_LECTURA}</p>
            </div>
        );
    }
    return <SolapaMateriasPrimas {...props} />;
}

function SolapaMateriasPrimas({
    idOrden,
    edita: puedeEditar,
    activo = true,
    numeroOT,
    unidadesOT,
    idArticulo,
    lineasLocales,
    onLineasLocalesChange,
    noLleva = false,
    onNoLlevaChange,
    onLineasChange,
    onSinGuardarChange,
    consumo: consumoDelModal,
}: MateriasPrimasOTProps) {
    const modoLocal = idOrden === null;
    const { confirmar, dialogo } = useConfirmarForzar();
    const { catalogos } = useCatalogosMP();
    // Prueba piloto: con el Integral como dueño, quien puede escribir la usa en MODO
    // PRÁCTICA (todo se toca, nada se guarda) y el resto la mira; mientras no se sabe quién
    // es el dueño, nadie edita (es un instante: ver ModoEspejo.tsx).
    const dueno = useDuenoMP();
    const espejo = dueno.espejo;
    const modo = useModoMP(puedeEditar);
    const edita = modo !== "lectura";
    const practica = modo === "practica";
    const unidades = catalogos?.unidades_linea?.length ? catalogos.unidades_linea : UNIDADES_LINEA;
    const espesorSierra = catalogos?.espesor_sierra_mm ?? 3;

    const mp = useLineasDeOT({ idOrden, activo: activo && !modoLocal, confirmar });
    // Modo espejo: lo que marcan en el Integral aparece solo, con la OT abierta.
    useRefrescoEspejo(espejo && activo && !modoLocal && !!mp.datos, mp.recargar);

    // Los consumos (RF-15): los del modal si los trajo; si no, los propios. Un hook no se
    // llama «a veces»: se llama siempre, y sin id no pide nada.
    const consumoPropio = useConsumosDeOrden(
        consumoDelModal || modoLocal ? undefined : (idOrden ?? undefined),
        activo && !consumoDelModal && !modoLocal,
    );
    const consumo = consumoDelModal ?? consumoPropio;
    const conConsumo = !modoLocal && consumo.estado === "si";
    const [consumoAbierto, setConsumoAbierto] = useState<number | null>(null);
    useEffect(() => setConsumoAbierto(null), [idOrden]);

    // ─────────────── las filas ───────────────

    const locales = (lineasLocales ?? []) as LineaLocalMP[];
    // La última lista local, leída sin esperar al próximo dibujo: dos altas seguidas (dos
    // Enter rápidos) no pueden partir de la misma lista y pisarse.
    const localesRef = useRef(locales);
    localesRef.current = locales;
    const cambiarLocales = useCallback(
        (nuevas: LineaLocalMP[]) => {
            localesRef.current = nuevas;
            onLineasLocalesChange?.(nuevas);
        },
        [onLineasLocalesChange],
    );

    const filas: FilaMP[] = useMemo(() => {
        if (modoLocal) {
            return locales.map((l) => {
                const f = filaDeLocal(l);
                // Una OT nueva no tiene línea en la base que calcule la sugerencia: se
                // muestra la del espejo (ver sugerenciaMetros).
                return { ...f, sugerido_m: sugerenciaMetros(f.cortes, espesorSierra) };
            });
        }
        return mp.lineas.map((l) => filaDeLinea(l, mp.borrando.has(l.id)));
    }, [modoLocal, locales, mp.lineas, mp.borrando, espesorSierra]);

    const otEnCurso = !!mp.datos?.ot_en_curso;
    const noLlevaActual = modoLocal ? noLleva : (mp.datos?.no_lleva_materia_prima ?? noLleva);
    const numero = numeroOT ?? mp.datos?.numero_ot ?? null;

    // ─────────────── avisos al modal ───────────────

    const onLineasChangeRef = useRef(onLineasChange);
    onLineasChangeRef.current = onLineasChange;
    useEffect(() => {
        if (modoLocal || !mp.datos) return;
        onLineasChangeRef.current?.(mp.lineas, mp.cambios > 0 ? "cambio" : "carga");
    }, [modoLocal, mp.datos, mp.lineas, mp.cambios]);

    const [barraSucia, setBarraSucia] = useState(false);
    const sinGuardar = barraSucia || mp.enVuelo > 0;
    const onSinGuardarRef = useRef(onSinGuardarChange);
    onSinGuardarRef.current = onSinGuardarChange;
    useEffect(() => {
        onSinGuardarRef.current?.(sinGuardar);
    }, [sinGuardar]);
    // Al irse (se cerró el modal), que no quede marcado «sin guardar» en el modal.
    useEffect(() => () => onSinGuardarRef.current?.(false), []);

    // ─────────────── las líneas que no se guardaron al crear la OT ───────────────

    // Se miran UNA vez, cuando llegan las líneas de la OT (no con cada cambio: mientras
    // viaja el «Reintentar» el cartel volvería a aparecer).
    const [delAlta, setDelAlta] = useState<LineaLocal[] | null>(null);
    const cargada = !!mp.datos;
    useEffect(() => {
        setDelAlta(!modoLocal && idOrden && cargada ? leerSinGuardar(idOrden) : null);
    }, [modoLocal, idOrden, cargada]);

    // ─────────────── acciones ───────────────

    const siguienteOrden = () => Math.max(0, ...mp.lineas.map((l) => l.orden ?? 0)) + 1;

    const agregarDesdeBarra = async (c: CargaDeLinea): Promise<boolean> => {
        const entrada: LineaIn = {
            id_pieza: c.insumo.id,
            cantidad: c.cantidad,
            unidad: c.unidad,
            observaciones: c.observaciones,
            origen: "spmm",
        };
        const delInsumo = {
            codigo: c.insumo.codigo,
            descripcion: c.insumo.descripcion,
            tipo: c.insumo.tipo,
            precio: c.insumo.unitario,
            libre: c.insumo.libre,
            recortes: c.insumo.recortes_disponibles,
        };
        if (modoLocal) {
            cambiarLocales([...localesRef.current, lineaLocal(entrada, delInsumo)]);
            return true;
        }
        const temporal = lineaTemporal(idOrden!, entrada, delInsumo, siguienteOrden());
        return mp.agregar([{ entrada, temporal }], `cargar ${c.insumo.codigo}`);
    };

    const deHistorial = (l: LineaHistorial): LineaIn => ({
        id_pieza: l.id_pieza,
        cantidad: l.cantidad,
        unidad: l.unidad,
        descripcion: l.descripcion,
        id_proveedor: l.id_proveedor,
        proveedor: l.proveedor,
        cortes: (l.cortes ?? []).map((c) => ({ cantidad: c.cantidad, largo_mm: c.largo_mm ?? null, ancho_mm: c.ancho_mm ?? null })),
        origen: "historial",
    });

    const agregarHistorial = async (lineas: LineaHistorial[]): Promise<boolean> => {
        if (modoLocal) {
            cambiarLocales([
                ...localesRef.current,
                // La vista previa no trae el tipo ni el precio del insumo: la línea local
                // los muestra vacíos (el total estimado lo dice) y el backend los pone al crear.
                ...lineas.map((l) => lineaLocal(deHistorial(l), { codigo: l.codigo, descripcion: l.descripcion, tipo: null, precio: null })),
            ]);
            toast.success(`Se ${lineas.length === 1 ? "agregó 1 línea" : `agregaron ${lineas.length} líneas`} del historial`, {
                description: practica ? "Modo práctica: al crear la OT no se guardan." : "Se guardan al crear la OT.",
            });
            return true;
        }
        let orden = siguienteOrden();
        const entradas = lineas.map((l) => {
            const entrada = deHistorial(l);
            return {
                entrada,
                temporal: lineaTemporal(idOrden!, entrada, { codigo: l.codigo, descripcion: l.descripcion, tipo: null, precio: null }, orden++),
            };
        });
        const ok = await mp.agregar(entradas, `traer ${lineas.length === 1 ? "la línea" : `las ${lineas.length} líneas`} del historial`);
        if (ok) toast.success(`Se ${lineas.length === 1 ? "agregó 1 línea" : `agregaron ${lineas.length} líneas`} del historial`);
        return ok;
    };

    const reintentarDelAlta = async () => {
        if (!delAlta?.length || !idOrden) return;
        let orden = siguienteOrden();
        const entradas = delAlta.map((l) => {
            const x = l as LineaLocalMP;
            const entrada: LineaIn = {
                id_pieza: x.id_pieza, cantidad: x.cantidad, unidad: x.unidad ?? null, descripcion: x.descripcion ?? null,
                observaciones: x.observaciones ?? null, id_proveedor: x.id_proveedor ?? null, proveedor: x.proveedor ?? null,
                cortes: x.cortes ?? [], origen: x.origen ?? "spmm",
            };
            return {
                entrada,
                temporal: lineaTemporal(idOrden, entrada, { codigo: x.codigo, descripcion: x.descripcion_mostrada, tipo: x.tipo_pieza, precio: x.precio }, orden++),
            };
        });
        const pendientes = delAlta;
        setDelAlta(null);
        const ok = await mp.agregar(entradas, entradas.length === 1 ? "guardar la materia prima del alta" : `guardar las ${entradas.length} materias primas del alta`);
        if (ok) {
            olvidarSinGuardar(idOrden);
            toast.success(entradas.length === 1
                ? "Se guardó la materia prima que había quedado del alta"
                : `Se guardaron las ${entradas.length} materias primas que habían quedado del alta`);
        } else {
            setDelAlta(pendientes);
        }
    };

    const descartarDelAlta = () => {
        if (!idOrden) return;
        // Modo práctica: descartarlas también es un cambio (se pierden para siempre), y en
        // la práctica no se toca nada de verdad. Quedan para cuando SPMM sea el dueño.
        if (frenarPorPractica()) return;
        olvidarSinGuardar(idOrden);
        setDelAlta(null);
        toast("Se descartaron las materias primas que no se habían guardado al crear la OT");
    };

    const [cortesDe, setCortesDe] = useState<string | null>(null);
    const filaCortes = cortesDe ? (filas.find((f) => f.clave === cortesDe) ?? null) : null;

    // Las acciones de la fila en un objeto que no cambia (las filas son `memo`); por
    // dentro leen siempre lo último.
    const ultimo = useRef({ modoLocal, mp, cambiarLocales });
    ultimo.current = { modoLocal, mp, cambiarLocales };
    const acciones = useMemo<AccionesFilaMP>(
        () => ({
            cambiar: (f: FilaMP, c: CambiosFila) => {
                const u = ultimo.current;
                if (f.local) {
                    u.cambiarLocales(localesRef.current.map((l) => (l.clave === f.clave ? cambiarLineaLocal(l, c) : l)));
                    return;
                }
                // El guardado vuelve a la fila: la reserva lo espera (ver CasillaReserva).
                if (f.id !== null && f.id > 0) return u.mp.guardar(f.id, c);
            },
            borrar: (f: FilaMP) => {
                const u = ultimo.current;
                if (f.local) {
                    u.cambiarLocales(localesRef.current.filter((l) => l.clave !== f.clave));
                    return;
                }
                if (f.id !== null && f.id > 0) void u.mp.borrar(f.id);
            },
            abrirCortes: (f: FilaMP) => setCortesDe(f.clave),
            alternarConsumo: (id: number) => setConsumoAbierto((a) => (a === id ? null : id)),
        }),
        [],
    );

    const guardarCortes = (cortes: CorteIn[] | null, cantidad: { cantidad: number; unidad: string } | null) => {
        if (!filaCortes) return;
        // Modo práctica: el diálogo queda abierto con los cortes escritos (y sale el
        // cartelito). Los de una OT nueva no van al servidor: se guardan en memoria igual.
        if (!filaCortes.local && frenarPorPractica()) return false;
        const c: CambiosFila = {};
        if (cortes) {
            c.cortes = cortes;
            // Lo que se ve mientras contesta (el backend manda la suya con la línea).
            if (!filaCortes.local) c.sugerido_m = sugerenciaMetros(cortes, espesorSierra);
        }
        if (cantidad) {
            c.cantidad = cantidad.cantidad;
            if ((filaCortes.unidad ?? "") !== cantidad.unidad) c.unidad = cantidad.unidad;
        }
        if (Object.keys(c).length) acciones.cambiar(filaCortes, c);
    };

    const cambiarNoLleva = async (v: boolean) => {
        if (modoLocal) {
            // Modo práctica: en una OT nueva la marca viaja con el alta de la OT (no con las
            // líneas), así que se guardaría de verdad. No se deja tildar: sale el cartelito.
            if (frenarPorPractica()) return;
            onNoLlevaChange?.(v);
            return;
        }
        const ok = await mp.cambiarNoLleva(v);
        if (ok) onNoLlevaChange?.(v);
    };

    // ─────────────── traer historial ───────────────

    const [historialAbierto, setHistorialAbierto] = useState(false);
    const cargarHistorial = useCallback(() => {
        const unidades = unidadesOT && unidadesOT > 0 ? unidadesOT : null;
        if (idArticulo) {
            return mpGet<HistorialOT>(
                `${API_URL}/materia-prima/historial?${consulta({ id_articulo: idArticulo, unidades, excluir_ot: idOrden })}`,
            );
        }
        return mpGet<HistorialOT>(`${API_URL}/materia-prima/ot/${idOrden}/historial`);
    }, [idArticulo, unidadesOT, idOrden]);
    const historialNo = !idArticulo && modoLocal
        ? "Elegí el producto en la solapa General: el historial es el de la última OT de ese producto."
        : null;

    // ─────────────── cuentas del pie ───────────────

    const usadas = filas.filter((f) => f.usado && !f.borrando);
    const conPrecio = usadas.filter((f) => f.precio !== null && f.precio > 0);
    const total = conPrecio.reduce((s, f) => s + f.cantidad * (f.precio ?? 0), 0);
    const sinPrecio = usadas.length - conPrecio.length;
    const celdas = mp.datos?.celdas ?? [];

    // Consumos que no cuelgan de ninguna fila (cargados contra una línea que después se
    // borró): no se pierden de vista, siguen siendo de esta OT.
    const idsDeLineas = new Set(filas.map((f) => f.id).filter((x): x is number => x !== null && x > 0));
    const sueltos = conConsumo
        ? consumo.consumos.filter((c) => c.id_orden_trabajo_pieza == null || !idsDeLineas.has(c.id_orden_trabajo_pieza))
        : [];

    // ─────────────── dibujo ───────────────

    const listo = modoLocal || !!mp.datos;
    const estado = mp.estadoGuardado;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                        Materias primas
                        {listo && filas.length > 0 && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-gray-600">
                                {filas.length}
                            </span>
                        )}
                        {espejo ? (
                            <MarcaEspejo aviso={dueno.aviso} practica={practica} />
                        ) : (
                            !puedeEditar && <MarcaSoloLectura que="las materias primas" />
                        )}
                    </h3>
                    <p className="text-xs text-gray-500">
                        {practica && modoLocal
                            ? "Lo que lleva esta orden. Modo práctica: podés cargarlas para ver cómo es, pero al crear la OT no se guardan."
                            : practica
                            ? "Lo que lleva esta orden, tal como está en el Sistema Integral. Podés cargar y tocar todo para ver cómo es, pero no se guarda nada."
                            : espejo
                            ? "Lo que lleva esta orden, tal como está cargado en el Sistema Integral."
                            : modoLocal
                              ? "Lo que lleva esta orden. Se guarda al crear la OT; las marcas de compra se ponen después."
                              : "Lo que lleva esta orden. Cada cambio se guarda solo; la compra se sigue desde Materia prima › Pendientes."}
                    </p>
                </div>
                {!modoLocal && estado && (
                    <span
                        className={cn(
                            "text-[11px] font-medium",
                            estado === "guardando" ? "text-gray-500" : estado === "guardado" ? "text-green-700" : "text-rose-700",
                        )}
                        aria-live="polite"
                    >
                        {estado === "guardando" ? "Guardando…" : estado === "guardado" ? "Guardado" : "No se guardó el último cambio"}
                    </span>
                )}
            </div>

            {espejo && <CartelEspejo aviso={dueno.aviso} practica={practica} />}

            {mp.sinServidor && <CartelSinServidor />}

            {!mp.sinServidor && !modoLocal && !mp.datos && (
                mp.error ? (
                    <CartelError mensaje={mp.error} onReintentar={() => void mp.recargar()} />
                ) : (
                    <Esqueleto filas={4} />
                )
            )}

            {delAlta && delAlta.length > 0 && (
                <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    <p className="min-w-0 flex-1">
                        Al crear esta OT no se {delAlta.length === 1 ? "pudo" : "pudieron"} guardar{" "}
                        <b>{delAlta.length === 1 ? "1 materia prima" : `${delAlta.length} materias primas`}</b>{" "}
                        ({delAlta.map((l) => l.codigo).slice(0, 4).join(", ")}{delAlta.length > 4 ? "…" : ""}).{" "}
                        {delAlta.length === 1 ? "Quedó" : "Quedaron"} en este navegador.
                    </p>
                    {edita && (
                        <div className="flex shrink-0 gap-2">
                            <button type="button" onClick={descartarDelAlta} className="rounded-md px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
                                Descartar
                            </button>
                            <button
                                type="button"
                                onClick={() => void reintentarDelAlta()}
                                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                            >
                                <RotateCcw className="h-3 w-3" /> Reintentar
                            </button>
                        </div>
                    )}
                </div>
            )}

            {listo && !mp.sinServidor && (
                <>
                    {edita && (
                        <BarraDeCarga
                            unidades={unidades}
                            onAgregar={agregarDesdeBarra}
                            onTraerHistorial={() => setHistorialAbierto(true)}
                            historialNo={historialNo}
                            historialCargando={false}
                            onSuciaChange={setBarraSucia}
                        />
                    )}

                    {modoLocal && filas.length > 0 && (
                        <p className="flex items-start gap-1.5 text-[11px] text-blue-800">
                            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                            {practica
                                ? `Modo práctica: ${filas.length === 1 ? "esta línea no se guarda" : `estas ${filas.length} líneas no se guardan`} al crear la OT (durante la prueba piloto se cargan en el Sistema Integral).`
                                : <>La OT todavía no existe: {filas.length === 1 ? "esta línea se guarda" : `estas ${filas.length} líneas se guardan`} al tocar «Crear Orden».</>}
                        </p>
                    )}

                    {/* `@container`: la fila que se abre para cargar el consumo mide su ancho
                        contra esta caja (100cqw), así queda a la vista aunque la tabla se
                        desplace de costado.
                        `isolate`: el encabezado y la columna fijos (z-20 / z-10) se apilan
                        ADENTRO de esta caja. Sin eso competían con la barra de solapas del
                        modal (también z-10, fija arriba) y al bajar la lista la tapaban: a
                        375 px desaparecían «General» y «Materias» (E2E del 24/09). */}
                    <div className="@container isolate overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                        <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left">
                            <thead className="bg-gray-50/90">
                                <tr className="[&>th]:border-b [&>th]:border-gray-200">
                                    <Th className="sticky left-0 z-20 bg-gray-50 pl-3">
                                        <span className="pl-5">Código</span>
                                    </Th>
                                    <Th>Descripción</Th>
                                    <Th className="text-right">Cant</Th>
                                    <Th>Un</Th>
                                    <Th>Proveedor</Th>
                                    <Th>Obs</Th>
                                    <Th className="text-center" title="Utilizado: si se destilda, la línea no entra en Pendientes ni en el estado del material">Utiliz.</Th>
                                    <Th className="text-center" title="Pedido al proveedor">Pedido</Th>
                                    <Th title="Reservado del stock (con cuánto)">Reserva</Th>
                                    <Th className="text-center" title="Disponible para producción">Disp.</Th>
                                    <Th className="text-center" title="En producción (PRODUC)">Prod.</Th>
                                    <Th className="text-right" title="Último precio de compra del insumo">Precio</Th>
                                    {conConsumo && <Th title="Lo registrado como consumido, carga por carga">Consumido</Th>}
                                    <Th title="Cortes (piezas × largo) y los metros sugeridos">Cortes</Th>
                                    <Th />
                                </tr>
                            </thead>
                            <tbody>
                                {filas.length === 0 ? (
                                    <tr>
                                        <td colSpan={columnasDeLaTabla(conConsumo)} className="p-0">
                                            <div className="sticky left-0 w-[100cqw] px-4 py-8 text-center text-sm text-gray-500">
                                                <Boxes className="mx-auto mb-2 h-6 w-6 text-gray-300" />
                                                {edita
                                                    ? "Todavía no tiene materias primas. Buscá el insumo arriba (código o descripción), poné la cantidad y Enter."
                                                    : espejo
                                                      ? "Esta orden no tiene materias primas cargadas en el Sistema Integral."
                                                      : "Esta orden no tiene materias primas cargadas."}
                                                <br />
                                                <span className="text-xs text-gray-400">
                                                    {/* En modo práctica la casilla de abajo está habilitada: el «se marca allá»
                                                        de sólo lectura decía lo contrario de lo que se ve. */}
                                                    {practica
                                                        ? "Si no lleva material, se marca abajo (en modo práctica no se guarda)."
                                                        : espejo
                                                        ? "Si no lleva material, se marca allá y acá aparece la casilla de abajo tildada."
                                                        : "Si no lleva material, marcalo abajo: así deja de figurar como que falta cargarla."}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filas.map((f, i) => {
                                        const abierto = conConsumo && f.id !== null && f.id > 0 && consumoAbierto === f.id;
                                        const totalConsumido = f.id !== null && f.id > 0 && conConsumo
                                            ? (consumo.totalPorLinea.get(f.id) ?? 0)
                                            : f.consumido;
                                        return (
                                            <Fragment key={f.clave}>
                                                <FilaMPOT
                                                    fila={f}
                                                    numero={i + 1}
                                                    edita={edita}
                                                    otEnCurso={otEnCurso}
                                                    unidades={unidades}
                                                    conConsumo={conConsumo}
                                                    consumido={totalConsumido}
                                                    consumoAbierto={abierto}
                                                    acciones={acciones}
                                                />
                                                {abierto && f.id !== null && (
                                                    <FilaDeConsumo
                                                        linea={{ idLinea: f.id, codigo: f.codigo, descripcion: f.descripcion, pedido: f.cantidad, unidad: f.unidad ?? "" }}
                                                        colSpan={columnasDeLaTabla(conConsumo)}
                                                        consumos={consumo.consumos.filter((c) => c.id_orden_trabajo_pieza === f.id)}
                                                        total={totalConsumido}
                                                        onRegistrar={(cantidad, obs) =>
                                                            consumo.registrar(
                                                                { idLinea: f.id!, codigo: f.codigo, descripcion: f.descripcion, pedido: f.cantidad, unidad: f.unidad ?? "" },
                                                                cantidad,
                                                                obs,
                                                            )
                                                        }
                                                        puedeAnular={consumo.puedeAnular}
                                                        onAnular={(id) => {
                                                            void consumo.anular(id);
                                                        }}
                                                    />
                                                )}
                                            </Fragment>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {sueltos.length > 0 && (
                        <div className="rounded-xl border border-gray-200 bg-white p-3">
                            <p className="text-xs font-semibold text-gray-700">Consumos de materiales que no están en la lista</p>
                            <p className="mb-1 text-[11px] text-gray-500">
                                Se registraron contra esta orden, pero no contra ninguna de las filas de arriba (la línea se borró después).
                            </p>
                            <ListaDeConsumos
                                consumos={sueltos}
                                puedeAnular={consumo.puedeAnular}
                                onAnular={(id) => {
                                    void consumo.anular(id);
                                }}
                                mostrarMaterial
                            />
                        </div>
                    )}
                    {!modoLocal && consumo.estado === "error" && filas.length > 0 && (
                        <p className="text-[11px] text-amber-700">
                            No se pudo leer lo consumido de esta orden. La lista de materiales está completa; volvé a abrir la
                            orden en un rato para ver y cargar el consumo.
                        </p>
                    )}

                    {/* El pie: «no lleva», cuánto sale, dónde está en la cañera y el salto a Pendientes. */}
                    <div className="flex flex-col gap-2.5 rounded-xl border border-gray-200 bg-gray-50/50 p-3 lg:flex-row lg:items-center lg:justify-between">
                        <label
                            className={cn(
                                "flex items-start gap-2.5",
                                edita ? "cursor-pointer" : "cursor-not-allowed opacity-80",
                            )}
                        >
                            <input
                                type="checkbox"
                                id="no_lleva_mp"
                                checked={noLlevaActual}
                                disabled={!edita}
                                onChange={(e) => void cambiarNoLleva(e.target.checked)}
                                className="mt-0.5 h-4 w-4 accent-gray-700"
                            />
                            <span className="text-sm">
                                <span className="font-semibold text-gray-800">Esta orden no lleva materias primas</span>
                                <span className="block text-xs text-gray-500">
                                    {noLlevaActual && usadas.length > 0
                                        ? `Ojo: tiene ${usadas.length} línea${usadas.length === 1 ? "" : "s"} cargada${usadas.length === 1 ? "" : "s"}; con esta marca no entra${usadas.length === 1 ? "" : "n"} en Pendientes.`
                                        : practica
                                          ? "En modo práctica no se guarda: durante la prueba piloto se marca en el Sistema Integral."
                                          : espejo
                                          ? "Se marca en el Sistema Integral; acá se ve como quedó."
                                          : "Marcala y la columna Material dice «No lleva» en vez de «Sin cargar», que es otra cosa."}
                                </span>
                            </span>
                        </label>

                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-600">
                            <span
                                title="Cantidad × último precio de compra de cada insumo, sólo las líneas utilizadas. Es una estimación: el precio es el de hoy, no el de la compra."
                            >
                                Total estimado{" "}
                                <b className="text-sm tabular-nums text-gray-900">{fmtPrecio(total, "$ 0,00")}</b>
                                {sinPrecio > 0 && (
                                    <span className="text-gray-400"> ({sinPrecio} sin precio)</span>
                                )}
                            </span>
                            {!modoLocal && (
                                <span className="inline-flex items-center gap-1.5" title="Dónde está el material cortado de esta OT (la cañera se maneja desde Materia prima › Cañera)">
                                    <MapPin className="h-3.5 w-3.5 text-gray-400" />
                                    {celdas.length ? (
                                        celdas.map((c) => (
                                            <span key={c} className="rounded border border-gray-300 bg-white px-1.5 py-px font-mono text-[11px] font-bold text-gray-800">
                                                {c}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-gray-400">Sin lugar en la cañera</span>
                                    )}
                                </span>
                            )}
                            {!modoLocal && numero && (
                                // En otra pestaña: lo que no se guardó de la OT (General, procesos)
                                // queda acá, con el modal abierto.
                                <a
                                    href={`/materia-prima?ot=${numero}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
                                    title="Abre Materia prima › Pendientes filtrado por esta OT, en otra pestaña"
                                >
                                    <Layers className="h-3.5 w-3.5" />
                                    Ver en Pendientes
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                    </div>
                </>
            )}

            <DialogoCortes
                fila={filaCortes}
                edita={edita && !!filaCortes && !filaCortes.enVuelo && !filaCortes.borrando}
                espesorSierraMm={espesorSierra}
                onCerrar={() => setCortesDe(null)}
                onGuardar={guardarCortes}
            />
            <DialogoHistorial
                abierto={historialAbierto}
                onCerrar={() => setHistorialAbierto(false)}
                cargar={cargarHistorial}
                yaHay={filas.length}
                onAgregar={agregarHistorial}
            />
            {dialogo}
        </div>
    );
}

export default MateriasPrimasOT;
