"use client";

/**
 * Los datos de un insumo: el alta y la edición, con el MISMO formulario.
 *
 * Lo usan la solapa General de la ficha (alta y edición) y el diálogo «+ Nuevo insumo»
 * de la solapa Materias primas de la OT. Que sea uno solo es a propósito: el insumo que
 * se da de alta apurado desde una OT tiene que quedar igual de bien armado que el que se
 * carga con calma en el catálogo, porque su código va a las facturas del sistema viejo.
 *
 * QUÉ ARMA EL BACKEND Y QUÉ NO
 *
 * La descripción de un insumo tipo «Insumo» (FORMATO + medidas + MATERIAL + CALIDAD) y
 * el código que le toca (prefijo + número) los arma el backend, y acá se MUESTRAN en vivo
 * pidiéndoselos a `POST /materia-prima/insumos/previsualizar` mientras se escribe (con
 * una espera corta y descartando las respuestas viejas). No se arman acá: son reglas con
 * vueltas (las pulgadas se escriben «1 1/4" (31.75mm)», el número del código se comparte
 * entre formatos con las mismas iniciales) y dos implementaciones terminan opinando
 * distinto. La misma respuesta avisa si ya hay otro insumo activo con esa descripción.
 *
 * Las medidas se guardan SIEMPRE en milímetros. En pulgadas se escriben como en el
 * taller («1 1/4», «3/8») y se mandan convertidas (`pulgadasAMm`); al lado de cada campo
 * se ve a cuántos milímetros equivale, para que un «11/4» mal tipeado se note antes de
 * guardar.
 *
 * El código no se cambia después del alta (lo usan las facturas del viejo) y el precio
 * no se toca acá: tiene su historial en la solapa Precios.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, Loader2, RotateCcw, Save, Sparkles } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { estaBajoMinimo } from "@/lib/stockMinimo";
import {
    fmtCantidad,
    fmtFecha,
    fmtFechaHora,
    fmtPrecio,
    leerCantidad,
    mmAPulgadasTexto,
    mpPost,
    mpPut,
    pulgadasAMm,
    rotuloTipo,
    TIPOS_INSUMO,
    type InsumoCambios,
    type InsumoFicha,
    type InsumoFila,
    type InsumoIn,
    type Previsualizacion,
    type PrevisualizarIn,
    type SistemaMedida,
    type TipoInsumo,
} from "@/lib/materiaPrima";
import { FiguraFormato } from "./FiguraFormato";
import { SelectorProveedor } from "./SelectorProveedor";
import { altaCalidad, altaMaterial, useCatalogosMP } from "./InsumoCatalogos";
import { AvisoConfirmacion, Rotulo, Segmentado } from "./InsumoComun";

// ═══════════════════════════ el borrador ═══════════════════════════

const LETRAS = ["A", "B", "C", "D", "E"];
const CINCO = [0, 1, 2, 3, 4];
const ESPERA_PREVIA_MS = 300;

/**
 * Lo que la persona tiene escrito. Los números van como TEXTO, tal cual se tipearon:
 * «1 1/4», «38,1» o un campo a medio escribir tienen que poder existir sin que nadie
 * los convierta mientras tanto.
 */
interface Borrador {
    /** Null = insumo sin clasificar que vino así del viejo (se trata como «c/ descripción»). */
    tipo: TipoInsumo | null;
    /** Sólo en el alta. Null = el que sugiere el backend (no se manda: lo arma al guardar). */
    codigo: string | null;
    descripcion: string;
    id_material: number | null;
    id_calidad: number | null;
    id_formato: number | null;
    sistema_medida: SistemaMedida;
    medidas: string[];
    unidad: string;
    /** Sólo en el alta: el primer precio (opcional). Después va por la solapa Precios. */
    precio: string;
    id_proveedor: number | null;
    proveedor: string | null;
    stock_minimo: string;
    estante: string;
    letra: string;
    nro: string;
    observaciones: string;
    inactivo: boolean;
}

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Un número para escribir en un campo: coma decimal y SIN separador de miles. Con el
 * de miles, 1250 se escribiría «1.250» y `leerCantidad` lo leería 1,25 al guardar.
 */
const textoNumero = (n: number | null | undefined): string =>
    n === null || n === undefined || !Number.isFinite(n) ? "" : String(redondear3(n)).replace(".", ",");

/** Una medida guardada (mm) como se escribe en el sistema elegido. */
const textoMedida = (mm: number | null | undefined, sistema: SistemaMedida): string =>
    sistema === "pulgada" ? mmAPulgadasTexto(mm).replace(/"$/, "") : textoNumero(mm);

interface Lectura {
    mm: number | null;
    /** Hay algo escrito que no se entiende. */
    error: boolean;
}

function leerMedida(texto: string, sistema: SistemaMedida): Lectura {
    const t = texto.trim();
    if (!t) return { mm: null, error: false };
    const mm = sistema === "pulgada" ? pulgadasAMm(t) : leerCantidad(t);
    if (mm === null || !(mm > 0)) return { mm: null, error: true };
    return { mm: redondear3(mm), error: false };
}

function desdeFicha(f: InsumoFicha): Borrador {
    const sistema: SistemaMedida = f.sistema_medida === "pulgada" ? "pulgada" : "mm";
    return {
        tipo: f.tipo ?? null,
        codigo: null,
        descripcion: f.descripcion ?? "",
        id_material: f.id_material ?? null,
        id_calidad: f.id_calidad ?? null,
        id_formato: f.id_formato ?? null,
        sistema_medida: sistema,
        medidas: CINCO.map((i) => textoMedida(f.medidas?.[i] ?? null, sistema)),
        unidad: f.unidad ?? "",
        precio: "",
        id_proveedor: f.id_proveedor ?? null,
        proveedor: f.proveedor_preferido?.razon_social ?? null,
        stock_minimo: textoNumero(f.stock_minimo),
        estante: f.estante ?? "",
        letra: f.letra ?? "",
        nro: f.nro ?? "",
        observaciones: f.observaciones ?? "",
        inactivo: !!f.inactivo,
    };
}

function enBlanco(tipo: TipoInsumo, descripcion = ""): Borrador {
    return {
        tipo,
        codigo: null,
        descripcion,
        id_material: null,
        id_calidad: null,
        id_formato: null,
        sistema_medida: "mm",
        medidas: CINCO.map(() => ""),
        // Sin unidad a propósito: el viejo proponía «HS» y quedaron cientos de barras
        // compradas «por hora». Se elige de un toque, y «Guardar y cargar otro» la conserva.
        unidad: "",
        precio: "",
        id_proveedor: null,
        proveedor: null,
        stock_minimo: "",
        estante: "",
        letra: "",
        nro: "",
        observaciones: "",
        inactivo: false,
    };
}

const vacioANull = (s: string) => (s.trim() ? s.trim() : null);

// ═══════════════════════════ el formulario ═══════════════════════════

export interface FormularioInsumoProps {
    /** La ficha que se edita. Null = alta. */
    ficha: InsumoFicha | null;
    edita: boolean;
    /** Alta: el tipo con que arranca (por defecto «Insumo»; con `descripcionInicial`, «c/ descripción»). */
    tipoInicial?: TipoInsumo;
    /** Alta: lo que ya se sabe de la descripción (lo que se tipeó en el buscador de la OT). */
    descripcionInicial?: string;
    /** Guardó bien: la ficha como la devolvió el backend. `otro` = «Guardar y cargar otro». */
    onGuardado: (ficha: InsumoFicha, como: { alta: boolean; otro: boolean }) => void;
    /**
     * Edición: el cambio que se está por mandar, para pintarlo ya en la lista. Devuelve
     * cómo deshacerlo si el backend no lo acepta.
     */
    onOptimista?: (parcial: Partial<InsumoFila>) => (() => void) | void;
    /** Hay algo escrito sin guardar (para avisar antes de cerrar la ficha). */
    onSucioChange?: (sucio: boolean) => void;
    /** El enlace del precio: ir a la solapa Precios. */
    onIrAPrecios?: () => void;
    /** Abrir otro insumo (el duplicado que avisó la vista previa). Sin esto, no se ofrece. */
    onAbrirInsumo?: (id: number) => void;
    /** Alta: el botón «Cancelar». Sin esto, no aparece. */
    onCancelar?: () => void;
    /** Alta: ofrecer «Guardar y cargar otro». En el diálogo de la OT no: ahí se viene a buscar uno. */
    permitirOtro?: boolean;
    autoFocus?: boolean;
    className?: string;
}

export function FormularioInsumo({
    ficha,
    edita,
    tipoInicial,
    descripcionInicial,
    onGuardado,
    onOptimista,
    onSucioChange,
    onIrAPrecios,
    onAbrirInsumo,
    onCancelar,
    permitirOtro = true,
    autoFocus = false,
    className,
}: FormularioInsumoProps) {
    const esAlta = ficha === null;
    const { catalogos, error: errorCatalogos, sinServidor: catalogosSinServidor } = useCatalogosMP();

    const blanco = useMemo(
        () => enBlanco(tipoInicial ?? (descripcionInicial?.trim() ? "insumo_desc" : "insumo"), descripcionInicial?.trim() ?? ""),
        // Es el punto de partida del alta: se calcula una vez.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );
    // `inicial` es contra qué se compara para saber si hay cambios: la ficha como vino (o
    // como quedó después de guardar), o el alta en blanco.
    const [inicial, setInicial] = useState<Borrador>(() => (ficha ? desdeFicha(ficha) : blanco));
    const [b, setB] = useState<Borrador>(inicial);
    const [guardando, setGuardando] = useState(false);
    /** El 409: el motivo y qué botón se había tocado, para repetirlo con `forzar`. */
    const [aviso, setAviso] = useState<{ motivo: string; otro: boolean } | null>(null);
    const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
    /** Qué medida tiene el foco: su cota se pinta en la figura. */
    const [enFoco, setEnFoco] = useState<number | null>(null);
    /** Mostrar lo que falta recién después de intentar guardar: no retar mientras se escribe. */
    const [intentado, setIntentado] = useState(false);

    const refsMedida = useRef<(HTMLInputElement | null)[]>([]);
    const refDescripcion = useRef<HTMLInputElement | null>(null);

    const cambiar = useCallback(<K extends keyof Borrador>(clave: K, valor: Borrador[K]) => {
        setB((prev) => ({ ...prev, [clave]: valor }));
        setAviso(null);
        setErrorGuardar(null);
    }, []);

    const tipo = b.tipo ?? "insumo_desc";
    const esEstructurado = tipo === "insumo";
    const formato = catalogos?.formatos.find((f) => f.id === b.id_formato) ?? null;
    const etiquetas = formato?.etiquetas ?? [];
    const material = catalogos?.materiales.find((m) => m.id === b.id_material) ?? null;

    const lecturas = useMemo(
        () => CINCO.map((i) => (i < etiquetas.length ? leerMedida(b.medidas[i] ?? "", b.sistema_medida) : { mm: null, error: false })),
        [b.medidas, b.sistema_medida, etiquetas.length],
    );
    const medidasMm = useMemo(() => lecturas.map((l) => l.mm), [lecturas]);
    const hayMedidaMala = lecturas.some((l) => l.error);

    const sucio = useMemo(() => JSON.stringify(b) !== JSON.stringify(inicial), [b, inicial]);
    // El aviso va por una ref: si dependiera de la identidad de `onSucioChange` (una
    // función nueva en cada dibujo de quien lo usa), cada dibujo del padre lo dispararía
    // de nuevo y el padre se volvería a dibujar.
    const alSucio = useRef(onSucioChange);
    useEffect(() => {
        alSucio.current = onSucioChange;
    });
    useEffect(() => {
        alSucio.current?.(sucio);
    }, [sucio]);
    // Al irse (cerrar la ficha, guardar y montar otra) ya no hay nada sin guardar acá.
    useEffect(() => () => alSucio.current?.(false), []);

    // ─────────────── la vista previa (descripción, código, duplicados) ───────────────

    const cambioLoQueDescribe =
        esAlta ||
        b.tipo !== inicial.tipo ||
        b.id_material !== inicial.id_material ||
        b.id_calidad !== inicial.id_calidad ||
        b.id_formato !== inicial.id_formato ||
        b.sistema_medida !== inicial.sistema_medida ||
        b.medidas.some((m, i) => m !== inicial.medidas[i]) ||
        b.descripcion !== inicial.descripcion;

    const pedidoPrevia: PrevisualizarIn | null = useMemo(() => {
        if (!edita || !cambioLoQueDescribe) return null;
        if (esEstructurado && b.id_material === null && b.id_formato === null) return null;
        if (!esEstructurado && !b.descripcion.trim()) return null;
        return {
            tipo,
            id_material: esEstructurado ? b.id_material : null,
            id_calidad: esEstructurado ? b.id_calidad : null,
            id_formato: esEstructurado ? b.id_formato : null,
            sistema_medida: b.sistema_medida,
            medidas: esEstructurado ? medidasMm : CINCO.map(() => null),
            descripcion: esEstructurado ? null : b.descripcion.trim(),
            excluir_id: ficha?.id ?? null,
        };
    }, [edita, cambioLoQueDescribe, esEstructurado, tipo, b.id_material, b.id_calidad, b.id_formato, b.sistema_medida, b.descripcion, medidasMm, ficha?.id]);
    const clavePrevia = pedidoPrevia ? JSON.stringify(pedidoPrevia) : "";

    const [previa, setPrevia] = useState<Previsualizacion | null>(null);
    const [previendo, setPreviendo] = useState(false);
    const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
    const ultimaPrevia = useRef(0);
    const controlPrevia = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!pedidoPrevia) {
            ultimaPrevia.current++;
            controlPrevia.current?.abort();
            setPrevia(null);
            setPreviendo(false);
            setErrorPrevia(null);
            return;
        }
        setPreviendo(true);
        const cuerpo = pedidoPrevia;
        const espera = setTimeout(async () => {
            const n = ++ultimaPrevia.current;
            controlPrevia.current?.abort();
            const c = new AbortController();
            controlPrevia.current = c;
            const r = await mpPost<Previsualizacion>(`${API_URL}/materia-prima/insumos/previsualizar`, cuerpo, { signal: c.signal });
            // Una respuesta que llega después de otra más nueva no pisa nada.
            if (n !== ultimaPrevia.current || r.abortado) return;
            setPreviendo(false);
            if (r.ok && r.data) {
                setPrevia({
                    descripcion: r.data.descripcion ?? null,
                    codigo_sugerido: r.data.codigo_sugerido ?? null,
                    faltan: r.data.faltan ?? [],
                    duplicados: r.data.duplicados ?? [],
                });
                setErrorPrevia(null);
            } else {
                setPrevia(null);
                // Sin la sección en el servidor, el cartel ya lo dice la lista: acá, nada.
                setErrorPrevia(r.sinServidor ? null : r.error);
            }
        }, ESPERA_PREVIA_MS);
        return () => clearTimeout(espera);
        // La clave es el pedido entero: sólo se vuelve a pedir si cambió algo que describe.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clavePrevia]);

    useEffect(() => () => controlPrevia.current?.abort(), []);

    // ─────────────── lo que falta ───────────────

    const faltanLocal: string[] = useMemo(() => {
        const f: string[] = [];
        if (esEstructurado) {
            if (!b.id_formato) f.push("Formato");
            etiquetas.forEach((e, i) => {
                if (lecturas[i]?.mm === null) f.push(e);
            });
            if (!b.id_material) f.push("Material");
        } else if (!b.descripcion.trim()) {
            f.push("Descripción");
        }
        if (esAlta && !b.unidad) f.push("Unidad");
        return f;
    }, [esEstructurado, b.id_formato, b.id_material, b.descripcion, b.unidad, etiquetas, lecturas, esAlta]);

    const minimo = leerCantidad(b.stock_minimo);
    const minimoMalo = b.stock_minimo.trim() !== "" && (minimo === null || minimo < 0);
    const precio = leerCantidad(b.precio);
    const precioMalo = b.precio.trim() !== "" && (precio === null || precio < 0);

    // ─────────────── guardar ───────────────

    const nombreMaterial = (id: number | null) => catalogos?.materiales.find((m) => m.id === id)?.nombre ?? null;
    const nombreCalidad = (idMat: number | null, id: number | null) =>
        catalogos?.materiales.find((m) => m.id === idMat)?.calidades.find((c) => c.id === id)?.nombre ?? null;
    const nombreFormato = (id: number | null) => catalogos?.formatos.find((f) => f.id === id)?.nombre ?? null;

    /** Las medidas a mandar: las que pide el formato, en mm; el resto en null. */
    const medidasParaMandar = () => CINCO.map((i) => (i < etiquetas.length ? medidasMm[i] : null));

    const cuerpoAlta = (): InsumoIn => ({
        tipo,
        codigo: b.codigo?.trim() ? b.codigo.trim().toUpperCase() : undefined,
        descripcion: esEstructurado ? undefined : b.descripcion.trim(),
        id_material: esEstructurado ? b.id_material : null,
        id_calidad: esEstructurado ? b.id_calidad : null,
        id_formato: esEstructurado ? b.id_formato : null,
        sistema_medida: b.sistema_medida,
        medidas: esEstructurado ? medidasParaMandar() : CINCO.map(() => null),
        unidad: b.unidad,
        unitario: precio !== null && precio > 0 ? precio : null,
        id_proveedor: b.id_proveedor,
        stock_minimo: minimo,
        estante: vacioANull(b.estante),
        letra: vacioANull(b.letra),
        nro: vacioANull(b.nro),
        observaciones: vacioANull(b.observaciones),
    });

    /** Sólo lo que cambió. La estructura va entera si cambió algo de ella: el backend rearma la descripción. */
    const cuerpoEdicion = (): InsumoCambios => {
        const c: InsumoCambios = {};
        if (b.tipo !== inicial.tipo && b.tipo) c.tipo = b.tipo;
        const cambioEstructura =
            b.id_material !== inicial.id_material ||
            b.id_calidad !== inicial.id_calidad ||
            b.id_formato !== inicial.id_formato ||
            b.sistema_medida !== inicial.sistema_medida ||
            b.medidas.some((m, i) => m !== inicial.medidas[i]);
        if (esEstructurado && (c.tipo || cambioEstructura)) {
            c.id_material = b.id_material;
            c.id_calidad = b.id_calidad;
            c.id_formato = b.id_formato;
            c.sistema_medida = b.sistema_medida;
            c.medidas = medidasParaMandar();
        }
        if (!esEstructurado && (c.tipo || b.descripcion !== inicial.descripcion)) c.descripcion = b.descripcion.trim();
        if (b.unidad !== inicial.unidad) c.unidad = b.unidad;
        if (b.id_proveedor !== inicial.id_proveedor) c.id_proveedor = b.id_proveedor;
        if (b.stock_minimo !== inicial.stock_minimo) c.stock_minimo = minimo;
        if (b.estante !== inicial.estante) c.estante = vacioANull(b.estante);
        if (b.letra !== inicial.letra) c.letra = vacioANull(b.letra);
        if (b.nro !== inicial.nro) c.nro = vacioANull(b.nro);
        if (b.observaciones !== inicial.observaciones) c.observaciones = vacioANull(b.observaciones);
        if (b.inactivo !== inicial.inactivo) c.inactivo = b.inactivo;
        return c;
    };

    const guardar = async (otro: boolean, forzar = false) => {
        if (guardando || !edita) return;
        setIntentado(true);
        setErrorGuardar(null);
        if (hayMedidaMala) {
            toast.error("Hay una medida que no se entiende. Revisá los campos en rojo.");
            return;
        }
        if (minimoMalo || precioMalo) {
            toast.error(minimoMalo ? "El punto crítico tiene que ser un número de 0 para arriba." : "El precio tiene que ser un número de 0 para arriba.");
            return;
        }
        if (faltanLocal.length) {
            toast.error(`Falta: ${faltanLocal.join(", ")}.`);
            return;
        }

        setGuardando(true);
        setAviso(null);

        if (esAlta) {
            const r = await mpPost<InsumoFicha>(`${API_URL}/materia-prima/insumos`, cuerpoAlta(), { forzar });
            setGuardando(false);
            if (r.requiereConfirmacion) {
                setAviso({ motivo: r.error ?? "Ya hay un insumo activo con esa descripción.", otro });
                return;
            }
            if (!r.ok || !r.data) {
                setErrorGuardar(r.error ?? "No se pudo dar de alta el insumo.");
                toast.error(r.error ?? "No se pudo dar de alta el insumo.");
                return;
            }
            toast.success(`Insumo ${r.data.codigo} dado de alta`);
            setIntentado(false);
            if (otro) {
                // Se queda con lo que se repite al cargar una tanda del mismo material
                // (tipo, material, calidad, formato, sistema, unidad, proveedor) y se
                // limpia lo que cambia de uno a otro. El foco vuelve a la primera medida.
                const siguiente: Borrador = {
                    ...enBlanco(b.tipo ?? "insumo"),
                    id_material: b.id_material,
                    id_calidad: b.id_calidad,
                    id_formato: b.id_formato,
                    sistema_medida: b.sistema_medida,
                    unidad: b.unidad,
                    id_proveedor: b.id_proveedor,
                    proveedor: b.proveedor,
                };
                setInicial(siguiente);
                setB(siguiente);
                setPrevia(null);
                setTimeout(() => (esEstructurado ? refsMedida.current[0] : refDescripcion.current)?.focus(), 0);
            }
            onGuardado(r.data, { alta: true, otro });
            return;
        }

        // Edición.
        if (!ficha) {
            setGuardando(false);
            return;
        }
        const cambios = cuerpoEdicion();
        if (!Object.keys(cambios).length) {
            setGuardando(false);
            setInicial(b);
            return;
        }
        const idMat = esEstructurado ? b.id_material : null;
        const revertir = onOptimista?.({
            tipo: b.tipo,
            descripcion: esEstructurado ? (previa?.descripcion ?? ficha.descripcion) : b.descripcion.trim(),
            material: nombreMaterial(idMat),
            calidad: nombreCalidad(idMat, esEstructurado ? b.id_calidad : null),
            formato: esEstructurado ? nombreFormato(b.id_formato) : null,
            unidad: b.unidad || null,
            stock_minimo: minimo,
            bajo_minimo: estaBajoMinimo(ficha.stock, minimo),
            estante: vacioANull(b.estante),
            letra: vacioANull(b.letra),
            nro: vacioANull(b.nro),
            proveedor: b.proveedor ?? ficha.proveedor_heredado ?? null,
            inactivo: b.inactivo,
        });
        const r = await mpPut<InsumoFicha>(`${API_URL}/materia-prima/insumos/${ficha.id}`, cambios, { forzar });
        setGuardando(false);
        if (r.requiereConfirmacion) {
            revertir?.();
            setAviso({ motivo: r.error ?? "El servidor pide confirmar el cambio.", otro: false });
            return;
        }
        if (!r.ok || !r.data) {
            revertir?.();
            setErrorGuardar(r.error ?? "No se pudo guardar.");
            toast.error(`No se guardó ${ficha.codigo}: ${r.error ?? "error desconocido"}`);
            return;
        }
        toast.success(`${r.data.codigo}: cambios guardados`);
        const nuevo = desdeFicha(r.data);
        setInicial(nuevo);
        setB(nuevo);
        setIntentado(false);
        onGuardado(r.data, { alta: false, otro: false });
    };

    const deshacer = () => {
        setB(inicial);
        setAviso(null);
        setErrorGuardar(null);
        setIntentado(false);
    };

    // Ctrl/⌘ + Enter guarda desde cualquier campo (en el alta, «Guardar»).
    const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (esAlta || sucio) void guardar(false);
        }
    };

    // ─────────────── cambios que arrastran otros ───────────────

    const cambiarTipo = (t: TipoInsumo) => {
        setB((prev) => {
            // Al pasar a descripción libre se arranca de la descripción que ya estaba
            // armada: casi siempre es retocarla, no escribirla de cero.
            const armada = previa?.descripcion ?? ficha?.descripcion ?? "";
            const descripcion = t !== "insumo" && !prev.descripcion.trim() ? armada : prev.descripcion;
            return { ...prev, tipo: t, descripcion };
        });
        setAviso(null);
    };

    const cambiarMaterial = (id: number | null) => {
        setB((prev) => {
            const mat = catalogos?.materiales.find((m) => m.id === id);
            const sigueLaCalidad = !!mat?.calidades.some((c) => c.id === prev.id_calidad);
            return { ...prev, id_material: id, id_calidad: sigueLaCalidad ? prev.id_calidad : null };
        });
        setAviso(null);
    };

    // mm ↔ pulgada: lo escrito se convierte, así cambiar de sistema no borra nada.
    const cambiarSistema = (s: SistemaMedida) => {
        setB((prev) => {
            if (prev.sistema_medida === s) return prev;
            const medidas = prev.medidas.map((t) => {
                const l = leerMedida(t, prev.sistema_medida);
                return l.mm === null ? t : textoMedida(l.mm, s);
            });
            return { ...prev, sistema_medida: s, medidas };
        });
        setAviso(null);
    };

    const cambiarMedida = (i: number, texto: string) => {
        setB((prev) => {
            const medidas = [...prev.medidas];
            medidas[i] = texto;
            return { ...prev, medidas };
        });
        setAviso(null);
    };

    // ─────────────── altas en el momento ───────────────

    const crearMaterial = async (nombre: string) => {
        const r = await altaMaterial(nombre);
        if (!r.dato) {
            toast.error(r.error ?? "No se pudo dar de alta el material.");
            return;
        }
        toast.success(`Material «${r.dato.nombre}» dado de alta`);
        cambiarMaterial(r.dato.id);
    };

    const crearCalidad = async (nombre: string) => {
        if (b.id_material === null) return;
        const r = await altaCalidad(b.id_material, nombre);
        if (!r.dato) {
            toast.error(r.error ?? "No se pudo dar de alta la calidad.");
            return;
        }
        toast.success(`Calidad «${r.dato.nombre}» dada de alta`);
        cambiar("id_calidad", r.dato.id);
    };

    // ─────────────── opciones ───────────────

    const opcionesMaterial = useMemo(() => {
        const o = (catalogos?.materiales ?? []).map((m) => ({ value: String(m.id), label: m.nombre }));
        // Un material que ya no está activo sigue mostrándose en la ficha que lo usa.
        if (ficha?.id_material && !o.some((x) => x.value === String(ficha.id_material))) {
            o.unshift({ value: String(ficha.id_material), label: ficha.material ?? `Material ${ficha.id_material}` });
        }
        return o;
    }, [catalogos, ficha?.id_material, ficha?.material]);

    const opcionesCalidad = useMemo(() => {
        const o = (material?.calidades ?? []).map((c) => ({ value: String(c.id), label: c.nombre }));
        if (ficha?.id_calidad && b.id_material === ficha.id_material && !o.some((x) => x.value === String(ficha.id_calidad))) {
            o.unshift({ value: String(ficha.id_calidad), label: ficha.calidad ?? `Calidad ${ficha.id_calidad}` });
        }
        return o;
    }, [material, ficha?.id_calidad, ficha?.id_material, ficha?.calidad, b.id_material]);

    const opcionesFormato = useMemo(() => {
        const o = (catalogos?.formatos ?? []).map((f) => ({ value: String(f.id), label: f.nombre }));
        if (ficha?.id_formato && !o.some((x) => x.value === String(ficha.id_formato))) {
            o.unshift({ value: String(ficha.id_formato), label: ficha.formato ?? `Formato ${ficha.id_formato}` });
        }
        return o;
    }, [catalogos, ficha?.id_formato, ficha?.formato]);

    const unidades = useMemo(() => {
        const base = catalogos?.unidades?.length ? catalogos.unidades : ["UN", "MTS", "KG", "LTS", "HS"];
        // Una unidad heredada que no está en la lista («Un», «Mts») se sigue viendo elegida.
        return inicial.unidad && !base.includes(inicial.unidad) ? [...base, inicial.unidad] : base;
    }, [catalogos, inicial.unidad]);

    // ─────────────── sólo lectura ───────────────

    if (!edita) {
        return <VistaInsumo ficha={ficha} onIrAPrecios={onIrAPrecios} className={className} />;
    }

    const descripcionArmada = esEstructurado
        ? (cambioLoQueDescribe ? previa?.descripcion ?? null : ficha?.descripcion ?? null)
        : null;
    const faltanParaMostrar = previa?.faltan?.length ? previa.faltan : faltanLocal.filter((f) => f !== "Unidad");
    const sugerido = previa?.codigo_sugerido ?? null;
    const duplicados = previa?.duplicados ?? [];

    return (
        // `@container`: el formulario se acomoda al ancho de SU caja (el panel de la ficha, el
        // diálogo de la OT, el teléfono), no al de la ventana: en una ventana ancha el panel
        // puede ser angosto.
        <div className={cn("@container flex min-h-full flex-col", className)} onKeyDown={alTeclear}>
            <div className="flex-1 space-y-5 px-4 py-4">
                {(errorCatalogos && !catalogosSinServidor) && (
                    <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        No se pudieron traer los materiales y formatos: {errorCatalogos}
                    </p>
                )}

                {/* ── Qué es ── */}
                <section className="space-y-3">
                    <div>
                        <Rotulo>Tipo</Rotulo>
                        <Segmentado
                            parejo
                            aria-label="Tipo de insumo"
                            opciones={TIPOS_INSUMO.map((t) => ({
                                valor: t.valor,
                                rotulo: t.nombre,
                                titulo:
                                    t.valor === "insumo"
                                        ? "Material con formato y medidas: la descripción y el código se arman solos."
                                        : t.valor === "insumo_desc"
                                            ? "Material con descripción libre (lo que no encaja en un formato)."
                                            : "Lo que se gasta y no es materia prima de la pieza: discos, electrodos, mechas.",
                            }))}
                            valor={b.tipo}
                            onCambiar={cambiarTipo}
                        />
                        {b.tipo === null && (
                            <p className="mt-1 text-[11px] text-gray-500">
                                Vino sin clasificar del sistema viejo: se trata como «c/ descripción» hasta que elijas uno.
                            </p>
                        )}
                    </div>

                    {esEstructurado ? (
                        <>
                            <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                                <div className="min-w-0">
                                    <Rotulo>Material</Rotulo>
                                    <SearchableSelect
                                        options={opcionesMaterial}
                                        value={b.id_material ? String(b.id_material) : ""}
                                        onValueChange={(v) => cambiarMaterial(v ? Number(v) : null)}
                                        placeholder={catalogos ? "Elegí el material…" : "Cargando…"}
                                        onCreate={crearMaterial}
                                        createLabel="Dar de alta el material"
                                        triggerClassName={cn(intentado && !b.id_material && "border-rose-300")}
                                    />
                                </div>
                                <div className="min-w-0">
                                    <Rotulo>Calidad</Rotulo>
                                    <SearchableSelect
                                        options={opcionesCalidad}
                                        value={b.id_calidad ? String(b.id_calidad) : ""}
                                        onValueChange={(v) => cambiar("id_calidad", v ? Number(v) : null)}
                                        placeholder={b.id_material ? "Sin calidad" : "Primero el material"}
                                        disabled={!b.id_material}
                                        onCreate={b.id_material ? crearCalidad : undefined}
                                        createLabel="Dar de alta la calidad"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 @md:grid-cols-[minmax(0,1fr)_auto]">
                                <div className="min-w-0">
                                    <Rotulo>Formato</Rotulo>
                                    <SearchableSelect
                                        options={opcionesFormato}
                                        value={b.id_formato ? String(b.id_formato) : ""}
                                        onValueChange={(v) => cambiar("id_formato", v ? Number(v) : null)}
                                        placeholder={catalogos ? "Elegí el formato…" : "Cargando…"}
                                        triggerClassName={cn(intentado && !b.id_formato && "border-rose-300")}
                                    />
                                </div>
                                <div>
                                    <Rotulo>Medidas en</Rotulo>
                                    <Segmentado
                                        aria-label="Sistema de medida"
                                        className="h-9 items-center"
                                        opciones={[
                                            { valor: "mm", rotulo: "mm" },
                                            { valor: "pulgada", rotulo: "Pulgada", titulo: "Se escriben como en el taller: 1 1/4, 3/8, 2. Se guardan en milímetros." },
                                        ]}
                                        valor={b.sistema_medida}
                                        onCambiar={cambiarSistema}
                                    />
                                </div>
                            </div>

                            {/* Las medidas que pide el formato, cada una con la letra de su cota. */}
                            <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3 @md:flex-row @md:items-start">
                                <FiguraFormato
                                    formato={formato?.nombre ?? null}
                                    etiquetas={formato ? etiquetas : null}
                                    activa={enFoco}
                                    className="mx-auto h-24 w-28 shrink-0 @md:mx-0"
                                />
                                <div className="min-w-0 flex-1 space-y-2">
                                    {!formato ? (
                                        <p className="py-6 text-center text-xs text-gray-500 @md:text-left">
                                            Elegí el formato y aparecen las medidas que lleva.
                                        </p>
                                    ) : (
                                        etiquetas.map((etiqueta, i) => {
                                            const l = lecturas[i];
                                            const falta = intentado && l.mm === null && !l.error;
                                            return (
                                                <div key={`${formato.id}-${i}`}>
                                                    <div className="flex items-center gap-2">
                                                        <label
                                                            htmlFor={`medida-${i}`}
                                                            className={cn(
                                                                "flex w-32 shrink-0 items-center gap-1.5 text-xs text-gray-600",
                                                                enFoco === i && "text-red-700",
                                                            )}
                                                        >
                                                            <span
                                                                className={cn(
                                                                    "inline-flex h-5 w-5 items-center justify-center rounded bg-white text-[11px] font-bold text-gray-700 ring-1 ring-gray-200",
                                                                    enFoco === i && "bg-red-50 text-red-700 ring-red-200",
                                                                )}
                                                            >
                                                                {LETRAS[i]}
                                                            </span>
                                                            <span className="truncate" title={etiqueta}>{etiqueta}</span>
                                                        </label>
                                                        <div className="relative min-w-0 flex-1">
                                                            <Input
                                                                id={`medida-${i}`}
                                                                ref={(el) => {
                                                                    refsMedida.current[i] = el;
                                                                }}
                                                                inputMode={b.sistema_medida === "pulgada" ? "text" : "decimal"}
                                                                autoComplete="off"
                                                                autoFocus={autoFocus && i === 0 && esAlta}
                                                                value={b.medidas[i] ?? ""}
                                                                placeholder={b.sistema_medida === "pulgada" ? "1 1/4" : "0"}
                                                                onChange={(e) => cambiarMedida(i, e.target.value)}
                                                                onFocus={() => setEnFoco(i)}
                                                                onBlur={() => setEnFoco((f) => (f === i ? null : f))}
                                                                // El nombre explícito: el <label> de arriba junta la letra
                                                                // de la cota y la etiqueta («ALado») y hay lectores que
                                                                // toman el placeholder («0»). Así dice «Lado, en mm».
                                                                aria-label={`${etiqueta}, en ${b.sistema_medida === "pulgada" ? "pulgadas" : "mm"}`}
                                                                aria-invalid={l.error || falta}
                                                                className={cn(
                                                                    "h-9 bg-white pr-10 tabular-nums",
                                                                    (l.error || falta) && "border-rose-300 focus-visible:ring-rose-300",
                                                                )}
                                                            />
                                                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                                                                {b.sistema_medida === "pulgada" ? "pulg" : "mm"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {l.error ? (
                                                        <p className="mt-0.5 pl-[8.5rem] text-[11px] text-rose-600">
                                                            {b.sistema_medida === "pulgada"
                                                                ? "No se entiende: escribí 1 1/4, 3/8, 2 o 1,5."
                                                                : "Tiene que ser un número mayor que cero."}
                                                        </p>
                                                    ) : b.sistema_medida === "pulgada" && l.mm !== null ? (
                                                        <p className="mt-0.5 pl-[8.5rem] text-[11px] tabular-nums text-gray-500">
                                                            = {fmtCantidad(l.mm)} mm
                                                        </p>
                                                    ) : null}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* La descripción que va a quedar, armada por el backend. */}
                            <div>
                                <Rotulo>Descripción</Rotulo>
                                <div
                                    className={cn(
                                        "flex min-h-10 items-start gap-2 rounded-md border px-3 py-2 text-sm",
                                        descripcionArmada ? "border-gray-200 bg-white text-gray-900" : "border-dashed border-gray-200 bg-gray-50 text-gray-400",
                                    )}
                                    aria-live="polite"
                                >
                                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" aria-hidden />
                                    <span className={cn("min-w-0 flex-1 break-words font-medium", previendo && "opacity-60")}>
                                        {descripcionArmada ??
                                            (faltanParaMostrar.length && (b.id_formato || b.id_material)
                                                ? `Falta: ${faltanParaMostrar.join(", ")}`
                                                : "Se arma sola con el formato, las medidas y el material.")}
                                    </span>
                                    {previendo && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-gray-400" />}
                                </div>
                                {descripcionArmada && previa && previa.faltan.length > 0 && (
                                    <p className="mt-1 text-[11px] text-amber-700">Falta: {previa.faltan.join(", ")}</p>
                                )}
                            </div>
                        </>
                    ) : (
                        <div>
                            <Rotulo htmlFor="descripcion-insumo">Descripción</Rotulo>
                            <Input
                                id="descripcion-insumo"
                                ref={refDescripcion}
                                autoFocus={autoFocus && esAlta}
                                value={b.descripcion}
                                onChange={(e) => cambiar("descripcion", e.target.value)}
                                placeholder={tipo === "consumible" ? "Ej.: DISCO DE CORTE 115 X 1 MM" : "Ej.: CHAPA LAF 2 MM 1220 X 2440"}
                                maxLength={255}
                                className={cn("h-9", intentado && !b.descripcion.trim() && "border-rose-300")}
                            />
                            {previendo && (
                                <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Buscando si ya existe…
                                </p>
                            )}
                        </div>
                    )}

                    {errorPrevia && (
                        <p className="text-[11px] text-rose-600">No se pudo armar la vista previa: {errorPrevia}</p>
                    )}

                    {duplicados.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            <p className="flex items-center gap-1.5 font-semibold">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                {duplicados.length === 1 ? "Ya hay un insumo activo igual:" : `Ya hay ${duplicados.length} insumos activos iguales:`}
                            </p>
                            <ul className="mt-1 space-y-0.5">
                                {duplicados.slice(0, 5).map((d) => (
                                    <li key={d.id} className="flex items-center gap-2">
                                        <span className="font-mono font-bold">{d.codigo}</span>
                                        <span className="min-w-0 flex-1 truncate" title={d.descripcion}>{d.descripcion}</span>
                                        {onAbrirInsumo && (
                                            <button
                                                type="button"
                                                onClick={() => onAbrirInsumo(d.id)}
                                                className="inline-flex shrink-0 items-center gap-0.5 font-medium text-amber-800 underline-offset-2 hover:underline"
                                            >
                                                Abrir <ArrowUpRight className="h-3 w-3" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-1 text-amber-800/80">Se puede crear igual, pero conviene usar el que ya está.</p>
                        </div>
                    )}

                    <div>
                        <Rotulo htmlFor="codigo-insumo">Código</Rotulo>
                        {esAlta ? (
                            <>
                                <Input
                                    id="codigo-insumo"
                                    value={b.codigo ?? sugerido ?? ""}
                                    onChange={(e) => cambiar("codigo", e.target.value.toUpperCase())}
                                    placeholder={sugerido ?? "Se arma al guardar"}
                                    maxLength={10}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="h-9 max-w-[12rem] font-mono font-bold uppercase placeholder:font-sans placeholder:font-normal placeholder:normal-case"
                                />
                                <p className="mt-1 text-[11px] text-gray-500">
                                    {b.codigo === null
                                        ? sugerido
                                            ? "El que sigue con la regla del sistema viejo. Se confirma al guardar."
                                            : "Se arma solo con la regla del sistema viejo."
                                        : (
                                            <>
                                                Escrito a mano: tiene que ser único.{" "}
                                                <button
                                                    type="button"
                                                    onClick={() => cambiar("codigo", null)}
                                                    className="font-medium text-blue-700 hover:underline"
                                                >
                                                    Usar el sugerido{sugerido ? ` (${sugerido})` : ""}
                                                </button>
                                            </>
                                        )}
                                </p>
                            </>
                        ) : (
                            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-sm font-bold text-gray-900">{ficha?.codigo}</span>
                                <span className="text-[11px] text-gray-500">No se cambia: lo usan las facturas del sistema viejo.</span>
                            </p>
                        )}
                    </div>
                </section>

                {/* ── Compra y stock ── */}
                <section className="space-y-3 border-t border-gray-100 pt-4">
                    <div>
                        <Rotulo>Unidad</Rotulo>
                        <Segmentado
                            aria-label="Unidad"
                            opciones={unidades.map((u) => ({ valor: u, rotulo: u }))}
                            valor={b.unidad || null}
                            onCambiar={(u) => cambiar("unidad", u)}
                            className={cn(intentado && esAlta && !b.unidad && "ring-rose-300")}
                        />
                        {/* El rojo solo no alcanzaba: al tocar «Guardar» sin unidad no
                            pasaba nada visible más que el borde (el toast se iba solo). No
                            hay unidad por defecto a propósito (ver `enBlanco`). */}
                        {intentado && esAlta && !b.unidad && (
                            <p role="alert" className="mt-1 text-[11px] text-rose-600">
                                Elegí la unidad: con ella se compra y se cuenta el stock (MTS para barras, UN para piezas sueltas…).
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                        <div>
                            <Rotulo htmlFor={esAlta ? "precio-insumo" : undefined}>{esAlta ? "Precio (opcional)" : "Último precio"}</Rotulo>
                            {esAlta ? (
                                <>
                                    <div className="relative">
                                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                                        <Input
                                            id="precio-insumo"
                                            inputMode="decimal"
                                            value={b.precio}
                                            onChange={(e) => cambiar("precio", e.target.value)}
                                            placeholder="0,00"
                                            className={cn("h-9 pl-6 tabular-nums", precioMalo && "border-rose-300")}
                                        />
                                    </div>
                                    <p className="mt-1 text-[11px] text-gray-500">Queda como el primero del historial, con fecha de hoy.</p>
                                </>
                            ) : (
                                <div className="flex h-9 items-center gap-2 text-sm">
                                    <span className="font-semibold tabular-nums text-gray-900">{fmtPrecio(ficha?.unitario, "Sin precio")}</span>
                                    {ficha?.fecha_ultimo_precio && (
                                        <span className="text-xs text-gray-500">{fmtFecha(ficha.fecha_ultimo_precio)}</span>
                                    )}
                                    {onIrAPrecios && (
                                        <button
                                            type="button"
                                            onClick={onIrAPrecios}
                                            className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-blue-700 hover:underline"
                                        >
                                            Precios <ArrowUpRight className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <Rotulo htmlFor="minimo-insumo">Punto crítico</Rotulo>
                            <div className="relative">
                                <Input
                                    id="minimo-insumo"
                                    inputMode="decimal"
                                    value={b.stock_minimo}
                                    onChange={(e) => cambiar("stock_minimo", e.target.value)}
                                    placeholder="Sin mínimo"
                                    className={cn("h-9 pr-12 tabular-nums", minimoMalo && "border-rose-300")}
                                />
                                {b.unidad && (
                                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">{b.unidad}</span>
                                )}
                            </div>
                            <p className="mt-1 text-[11px] text-gray-500">Si el stock físico queda abajo, avisa la campanita.</p>
                        </div>
                    </div>

                    <div>
                        <Rotulo>Proveedor preferido</Rotulo>
                        <SelectorProveedor
                            valor={{ id: b.id_proveedor, nombre: b.proveedor }}
                            onCambiar={(v) => {
                                setB((prev) => ({ ...prev, id_proveedor: v.id, proveedor: v.id ? v.nombre : null }));
                                setAviso(null);
                            }}
                            placeholder="Sin proveedor preferido"
                        />
                        {ficha?.proveedor_heredado && (
                            <p className="mt-1 text-[11px] text-gray-400" title="El texto que traía el sistema viejo. Queda de referencia; no se edita.">
                                En el sistema viejo: «{ficha.proveedor_heredado}»
                            </p>
                        )}
                    </div>
                </section>

                {/* ── Dónde está y notas ── */}
                <section className="space-y-3 border-t border-gray-100 pt-4">
                    <div>
                        <Rotulo>Ubicación en el depósito</Rotulo>
                        <div className="grid max-w-sm grid-cols-3 gap-2">
                            {([
                                ["estante", "Estante", "C1"],
                                ["letra", "Letra", "D"],
                                ["nro", "Nro", "6"],
                            ] as const).map(([clave, rotulo, ejemplo]) => (
                                <label key={clave} className="block">
                                    <span className="mb-0.5 block text-[10px] text-gray-500">{rotulo}</span>
                                    <Input
                                        value={b[clave]}
                                        onChange={(e) => cambiar(clave, clave === "nro" ? e.target.value : e.target.value.toUpperCase())}
                                        placeholder={ejemplo}
                                        maxLength={10}
                                        autoComplete="off"
                                        className="h-9 text-center font-mono uppercase"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <Rotulo htmlFor="obs-insumo">Observaciones</Rotulo>
                        <Textarea
                            id="obs-insumo"
                            rows={2}
                            value={b.observaciones}
                            onChange={(e) => cambiar("observaciones", e.target.value)}
                            placeholder="Lo que haya que saber de este insumo."
                            className="min-h-16 text-sm"
                        />
                    </div>

                    {!esAlta && (
                        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50">
                            <input
                                type="checkbox"
                                checked={b.inactivo}
                                onChange={(e) => cambiar("inactivo", e.target.checked)}
                                className="mt-0.5 h-4 w-4 accent-red-700"
                            />
                            <span className="text-sm">
                                <span className="font-medium text-gray-900">Inactivo</span>
                                <span className="block text-xs text-gray-500">
                                    Ya no se compra: no se ofrece al cargar materias primas en una OT. Lo cargado sigue como está.
                                </span>
                            </span>
                        </label>
                    )}
                </section>

                {ficha && <Estampas ficha={ficha} />}
            </div>

            {/* ── Botones: pegados abajo, siempre a la vista ── */}
            <div className="sticky bottom-0 z-10 space-y-2 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
                {aviso && (
                    <AvisoConfirmacion
                        motivo={aviso.motivo}
                        accion={esAlta ? "Crear igual" : "Guardar igual"}
                        ocupado={guardando}
                        onCancelar={() => setAviso(null)}
                        onConfirmar={() => void guardar(aviso.otro, true)}
                    />
                )}
                {errorGuardar && !aviso && (
                    <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800">{errorGuardar}</p>
                )}
                {/* Lo que falta, al lado del botón y mientras falte: el toast se va solo y el
                    campo en rojo (la unidad, sobre todo) puede haber quedado fuera de vista. */}
                {intentado && esAlta && faltanLocal.length > 0 && !aviso && !errorGuardar && (
                    <p className="text-xs text-rose-700">Falta: {faltanLocal.join(", ")}.</p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {esAlta ? (
                        <>
                            {onCancelar && (
                                <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={guardando}>
                                    Cancelar
                                </Button>
                            )}
                            {permitirOtro && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void guardar(true)}
                                    disabled={guardando}
                                    title="Guarda y deja el formulario listo para el siguiente: mismo tipo, material, calidad y formato."
                                >
                                    Guardar y cargar otro
                                </Button>
                            )}
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => void guardar(false)}
                                disabled={guardando}
                                className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                            >
                                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Guardar
                            </Button>
                        </>
                    ) : (
                        <>
                            {sucio && <span className="mr-auto text-xs text-amber-700">Hay cambios sin guardar</span>}
                            <Button type="button" variant="outline" size="sm" onClick={deshacer} disabled={!sucio || guardando}>
                                <RotateCcw className="h-4 w-4" />
                                Deshacer
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => void guardar(false)}
                                disabled={!sucio || guardando}
                                className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                            >
                                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Guardar cambios
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════ piezas de la ficha ═══════════════════════════

/** Quién lo dio de alta y quién lo tocó por última vez, y de dónde vino. */
function Estampas({ ficha }: { ficha: InsumoFicha }) {
    const partes: string[] = [];
    if (ficha.origen === "legacy") partes.push("Vino del sistema viejo");
    if (ficha.creado_en || ficha.creado_por) {
        partes.push(`Alta${ficha.creado_en ? ` el ${fmtFechaHora(ficha.creado_en)}` : ""}${ficha.creado_por ? ` por ${ficha.creado_por}` : ""}`);
    }
    if (ficha.modificado_en || ficha.modificado_por) {
        partes.push(`Último cambio${ficha.modificado_en ? ` el ${fmtFechaHora(ficha.modificado_en)}` : ""}${ficha.modificado_por ? ` por ${ficha.modificado_por}` : ""}`);
    }
    if (!partes.length) return null;
    return <p className="border-t border-gray-100 pt-3 text-[11px] text-gray-400">{partes.join(" · ")}</p>;
}

function Dato({ rotulo, children }: { rotulo: string; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{rotulo}</dt>
            <dd className="mt-0.5 break-words text-sm text-gray-900">{children}</dd>
        </div>
    );
}

/**
 * La ficha para quien no puede escribir: los mismos datos, leídos. Campos grises
 * deshabilitados se leen mal y parecen rotos; esto es una ficha.
 */
function VistaInsumo({ ficha, onIrAPrecios, className }: {
    ficha: InsumoFicha | null;
    onIrAPrecios?: () => void;
    className?: string;
}) {
    const { catalogos } = useCatalogosMP();
    if (!ficha) {
        return <p className="px-4 py-6 text-sm text-gray-500">No tenés permiso para dar de alta insumos.</p>;
    }
    const formato = catalogos?.formatos.find((f) => f.id === ficha.id_formato) ?? null;
    const etiquetas = formato?.etiquetas ?? [];
    const sistema: SistemaMedida = ficha.sistema_medida === "pulgada" ? "pulgada" : "mm";
    const ubicacion = [ficha.estante, ficha.letra, ficha.nro].filter(Boolean).join(" · ");
    const nada = <span className="text-gray-400">—</span>;
    return (
        <div className={cn("space-y-4 px-4 py-4", className)}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Dato rotulo="Tipo">{rotuloTipo(ficha.tipo)}</Dato>
                <Dato rotulo="Unidad">{ficha.unidad || nada}</Dato>
                {ficha.tipo === "insumo" && (
                    <>
                        <Dato rotulo="Material">{[ficha.material, ficha.calidad].filter(Boolean).join(" ") || nada}</Dato>
                        <Dato rotulo="Formato">{ficha.formato || nada}</Dato>
                    </>
                )}
            </dl>
            {ficha.tipo === "insumo" && formato && etiquetas.length > 0 && (
                <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                    <FiguraFormato formato={formato.nombre} etiquetas={etiquetas} className="h-20 w-24 shrink-0" />
                    <ul className="space-y-1 text-sm">
                        {etiquetas.map((e, i) => (
                            <li key={i} className="flex items-baseline gap-2">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-white text-[11px] font-bold text-gray-700 ring-1 ring-gray-200">{LETRAS[i]}</span>
                                <span className="text-gray-500">{e}:</span>
                                <span className="font-medium tabular-nums">
                                    {ficha.medidas?.[i] != null
                                        ? sistema === "pulgada"
                                            ? `${mmAPulgadasTexto(ficha.medidas[i])} (${fmtCantidad(ficha.medidas[i])} mm)`
                                            : `${fmtCantidad(ficha.medidas[i])} mm`
                                        : "—"}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Dato rotulo="Último precio">
                    {fmtPrecio(ficha.unitario, "Sin precio")}
                    {ficha.fecha_ultimo_precio && <span className="ml-1.5 text-xs text-gray-500">{fmtFecha(ficha.fecha_ultimo_precio)}</span>}
                    {onIrAPrecios && (
                        <button type="button" onClick={onIrAPrecios} className="ml-2 text-xs font-medium text-blue-700 hover:underline">
                            Historial
                        </button>
                    )}
                </Dato>
                <Dato rotulo="Punto crítico">
                    {ficha.stock_minimo != null ? `${fmtCantidad(ficha.stock_minimo)} ${ficha.unidad ?? ""}` : nada}
                </Dato>
                <Dato rotulo="Proveedor preferido">
                    {ficha.proveedor_preferido?.razon_social ?? nada}
                    {ficha.proveedor_heredado && (
                        <span className="block text-[11px] text-gray-400">En el sistema viejo: «{ficha.proveedor_heredado}»</span>
                    )}
                </Dato>
                <Dato rotulo="Ubicación">{ubicacion || nada}</Dato>
            </dl>
            {ficha.observaciones && (
                <dl>
                    <Dato rotulo="Observaciones"><span className="whitespace-pre-wrap">{ficha.observaciones}</span></Dato>
                </dl>
            )}
            {ficha.inactivo && (
                <p className="rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-600">
                    Inactivo: no se ofrece al cargar materias primas en una OT.
                </p>
            )}
            <Estampas ficha={ficha} />
        </div>
    );
}

export default FormularioInsumo;
