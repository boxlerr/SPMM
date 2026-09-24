"use client";

/**
 * Los cuatro pasos del armador de reportes (RF-23): de qué, qué columnas, qué filtros y
 * cómo agrupar. Cada uno recibe la receta y devuelve una receta nueva (no la toca): el
 * armador la guarda y la vista previa se pide sola.
 *
 * Lo que se puede elegir sale del catálogo que mandó el servidor, que ya viene recortado a
 * lo que esta persona puede ver: acá no se decide ningún permiso.
 */

import { useEffect, useMemo, useState } from "react";
import {
    ArrowDown,
    ArrowDownWideNarrow,
    ArrowUp,
    ArrowUpNarrowWide,
    CalendarDays,
    Check,
    ChevronDown,
    Filter,
    GripVertical,
    Info,
    Layers,
    Plus,
    Search,
    X,
} from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Flotante } from "./Flotante";
import { cn } from "@/lib/utils";
import {
    ATAJOS,
    fechaCorta,
    rangoDelAtajo,
    type Atajo,
    type ColumnaCatalogo,
    type ConfigReporte,
    type FiltroReporte,
    type FuenteCatalogo,
    type Funcion,
    type MedidaReporte,
    type Opcion,
    type ValorOpcion,
} from "@/lib/reportes";
import { iconoDeFuente } from "./iconos";

const NOMBRE_FUNCION: Record<Funcion, string> = {
    conteo: "Cantidad",
    suma: "Suma de",
    promedio: "Promedio de",
    minimo: "Mínimo de",
    maximo: "Máximo de",
};

const SELECT = "h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 shadow-sm focus:border-[#1e3a5f] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/15";
const INPUT = "h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 shadow-sm placeholder:text-gray-400 focus:border-[#1e3a5f] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/15";

// ─────────────────────────── el marco de cada paso ───────────────────────────

export function Paso({
    numero,
    titulo,
    resumen,
    children,
}: {
    numero: number;
    titulo: string;
    resumen?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_2px_10px_-4px_rgba(15,39,66,0.12)]">
            <header className="mb-3 flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#DC143C] to-[#B8112E] text-xs font-bold text-white shadow-sm">
                    {numero}
                </span>
                <h3 className="text-sm font-semibold text-gray-900">{titulo}</h3>
                {resumen && <span className="ml-auto truncate text-[11px] text-gray-500">{resumen}</span>}
            </header>
            {children}
        </section>
    );
}

// ─────────────────────────── 1. de qué ───────────────────────────

export function ElegirFuente({
    fuentes,
    actual,
    onElegir,
}: {
    fuentes: FuenteCatalogo[];
    actual: string | null;
    onElegir: (f: FuenteCatalogo) => void;
}) {
    const [abierto, setAbierto] = useState(!actual);
    // Abrir un guardado o un ejemplo cambia la fuente desde afuera: la grilla se cierra.
    useEffect(() => setAbierto(!actual), [actual]);
    const elegida = fuentes.find((f) => f.codigo === actual);

    if (elegida && !abierto) {
        const Icono = iconoDeFuente(elegida.icono);
        return (
            <div className="flex items-center gap-3 rounded-xl border-2 border-[#DC143C]/70 bg-[#DC143C]/[0.04] p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1e3a5f] text-white">
                    <Icono className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{elegida.nombre}</p>
                    <p className="line-clamp-2 text-xs text-gray-500">{elegida.descripcion}</p>
                </div>
                <button
                    type="button"
                    onClick={() => setAbierto(true)}
                    className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
                >
                    Cambiar
                </button>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fuentes.map((f) => {
                const Icono = iconoDeFuente(f.icono);
                const activa = f.codigo === actual;
                return (
                    <button
                        key={f.codigo}
                        type="button"
                        onClick={() => {
                            onElegir(f);
                            setAbierto(false);
                        }}
                        className={cn(
                            "group flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all",
                            activa
                                ? "border-[#DC143C] bg-[#DC143C]/[0.05] ring-2 ring-[#DC143C]/20"
                                : "border-gray-200 bg-white hover:-translate-y-px hover:border-[#1e3a5f]/40 hover:shadow-md",
                        )}
                    >
                        <span
                            className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                                activa ? "bg-[#DC143C] text-white" : "bg-[#1e3a5f]/10 text-[#1e3a5f] group-hover:bg-[#1e3a5f] group-hover:text-white",
                            )}
                        >
                            <Icono className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-[13px] font-semibold leading-tight text-gray-900">{f.nombre}</span>
                            <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-gray-500">{f.descripcion}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

// ─────────────────────────── 2. columnas ───────────────────────────

export function ElegirColumnas({
    fuente,
    receta,
    onCambiar,
}: {
    fuente: FuenteCatalogo;
    receta: ConfigReporte;
    onCambiar: (r: ConfigReporte) => void;
}) {
    const [buscar, setBuscar] = useState("");
    const [arrastrada, setArrastrada] = useState<number | null>(null);
    const porCodigo = useMemo(() => new Map(fuente.columnas.map((c) => [c.codigo, c])), [fuente]);
    const elegidas = receta.columnas.filter((c) => porCodigo.has(c));
    const libres = fuente.columnas.filter(
        (c) => !elegidas.includes(c.codigo) && c.nombre.toLowerCase().includes(buscar.trim().toLowerCase()),
    );

    const poner = (columnas: string[]) => onCambiar({ ...receta, columnas });
    const mover = (desde: number, hasta: number) => {
        if (hasta < 0 || hasta >= elegidas.length || desde === hasta) return;
        const nuevas = [...elegidas];
        const [c] = nuevas.splice(desde, 1);
        nuevas.splice(hasta, 0, c);
        poner(nuevas);
    };

    return (
        <div className="space-y-3">
            {receta.agrupar.length > 0 && (
                <p className="flex items-start gap-1.5 rounded-lg bg-[#1e3a5f]/5 px-2.5 py-2 text-[11px] leading-snug text-[#1e3a5f]">
                    <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Está agrupado: se ve una fila por grupo con sus cuentas. Estas columnas vuelven cuando saques la agrupación.
                </p>
            )}
            <ol className={cn("space-y-1", receta.agrupar.length > 0 && "opacity-50")}>
                {elegidas.map((codigo, i) => {
                    const c = porCodigo.get(codigo)!;
                    return (
                        <li
                            key={codigo}
                            draggable
                            onDragStart={() => setArrastrada(i)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                                if (arrastrada !== null) mover(arrastrada, i);
                                setArrastrada(null);
                            }}
                            onDragEnd={() => setArrastrada(null)}
                            className={cn(
                                "flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50/70 py-1 pl-1 pr-1 text-sm",
                                arrastrada === i && "border-dashed border-[#DC143C] bg-[#DC143C]/5",
                            )}
                        >
                            <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-gray-300 sm:block" aria-hidden />
                            <span className="w-5 shrink-0 text-center text-[11px] font-semibold text-gray-400">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-gray-800" title={c.ayuda ?? undefined}>{c.nombre}</span>
                            <BotonIcono titulo="Subir" onClick={() => mover(i, i - 1)} disabled={i === 0}>
                                <ArrowUp className="h-3.5 w-3.5" />
                            </BotonIcono>
                            <BotonIcono titulo="Bajar" onClick={() => mover(i, i + 1)} disabled={i === elegidas.length - 1}>
                                <ArrowDown className="h-3.5 w-3.5" />
                            </BotonIcono>
                            <BotonIcono titulo={`Sacar «${c.nombre}»`} onClick={() => poner(elegidas.filter((x) => x !== codigo))}>
                                <X className="h-3.5 w-3.5" />
                            </BotonIcono>
                        </li>
                    );
                })}
                {elegidas.length === 0 && (
                    <li className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500">
                        Todavía no elegiste columnas. Tocá las de abajo para sumarlas.
                    </li>
                )}
            </ol>
            <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Sumar columnas</span>
                    {fuente.columnas.length > 10 && (
                        <label className="relative w-36">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                            <input
                                value={buscar}
                                onChange={(e) => setBuscar(e.target.value)}
                                placeholder="Buscar"
                                className="h-7 w-full rounded-md border border-gray-200 pl-6 pr-2 text-xs focus:border-[#1e3a5f] focus:outline-none"
                                aria-label="Buscar columna"
                            />
                        </label>
                    )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {libres.map((c) => (
                        <button
                            key={c.codigo}
                            type="button"
                            onClick={() => poner([...elegidas, c.codigo])}
                            title={c.ayuda ?? undefined}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 transition-colors hover:border-[#DC143C] hover:bg-[#DC143C]/5 hover:text-[#B8112E]"
                        >
                            <Plus className="h-3 w-3" /> {c.nombre}
                        </button>
                    ))}
                    {libres.length === 0 && <span className="text-xs text-gray-400">No quedan columnas para sumar.</span>}
                </div>
            </div>
        </div>
    );
}

function BotonIcono({
    titulo,
    onClick,
    disabled,
    children,
}: {
    titulo: string;
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={titulo}
            aria-label={titulo}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-[#1e3a5f] disabled:opacity-30 disabled:hover:bg-transparent"
        >
            {children}
        </button>
    );
}

// ─────────────────────────── 3. período y filtros ───────────────────────────

export function ElegirPeriodo({
    fuente,
    receta,
    onCambiar,
}: {
    fuente: FuenteCatalogo;
    receta: ConfigReporte;
    onCambiar: (r: ConfigReporte) => void;
}) {
    const p = receta.periodo ?? null;
    const actual: Atajo | "todo" | "rango" = p?.atajo ? p.atajo : p?.desde || p?.hasta ? "rango" : "todo";
    const columnasDeFecha = fuente.periodo
        .map((c) => fuente.columnas.find((x) => x.codigo === c))
        .filter(Boolean) as ColumnaCatalogo[];
    const columna = p?.columna ?? fuente.periodo[0] ?? null;

    const elegir = (codigo: Atajo | "todo" | "rango") => {
        if (codigo === "todo") return onCambiar({ ...receta, periodo: null });
        if (codigo === "rango") {
            const base = p?.atajo ? rangoDelAtajo(p.atajo, new Date()) : rangoDelAtajo("este_mes", new Date());
            return onCambiar({ ...receta, periodo: { columna, desde: p?.desde ?? base.desde, hasta: p?.hasta ?? base.hasta } });
        }
        onCambiar({ ...receta, periodo: { columna, atajo: codigo } });
    };

    return (
        <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
                {ATAJOS.map(({ codigo, texto }) => (
                    <button
                        key={codigo}
                        type="button"
                        onClick={() => elegir(codigo)}
                        aria-pressed={actual === codigo}
                        className={cn(
                            "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                            actual === codigo
                                ? "border-[#1e3a5f] bg-[#1e3a5f] text-white shadow-sm"
                                : "border-gray-200 bg-white text-gray-600 hover:border-[#1e3a5f]/40 hover:text-[#1e3a5f]",
                        )}
                    >
                        {texto}
                    </button>
                ))}
            </div>
            {actual === "rango" && (
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        value={p?.desde ?? ""}
                        max={p?.hasta ?? undefined}
                        onChange={(e) => onCambiar({ ...receta, periodo: { ...p, columna, atajo: null, desde: e.target.value } })}
                        className={cn(INPUT, "w-[150px]")}
                        aria-label="Desde"
                    />
                    <span className="text-xs text-gray-400">al</span>
                    <input
                        type="date"
                        value={p?.hasta ?? ""}
                        min={p?.desde ?? undefined}
                        onChange={(e) => onCambiar({ ...receta, periodo: { ...p, columna, atajo: null, hasta: e.target.value } })}
                        className={cn(INPUT, "w-[150px]")}
                        aria-label="Hasta"
                    />
                </div>
            )}
            {actual !== "todo" && p?.atajo && (
                <p className="text-[11px] text-gray-500">
                    {fechaCorta(rangoDelAtajo(p.atajo, new Date()).desde)} al {fechaCorta(rangoDelAtajo(p.atajo, new Date()).hasta)}.
                    {" "}Guardado, «{ATAJOS.find((a) => a.codigo === p.atajo)?.texto.toLowerCase()}» es siempre el del día que se abre.
                </p>
            )}
            {fuente.periodo_interno ? (
                <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" /> {fuente.periodo_interno}
                </p>
            ) : columnasDeFecha.length > 1 && actual !== "todo" ? (
                <label className="flex items-center gap-2 text-xs text-gray-600">
                    <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                    Según
                    <select
                        value={columna ?? ""}
                        onChange={(e) => onCambiar({ ...receta, periodo: { ...p, columna: e.target.value } })}
                        className={cn(SELECT, "h-8 w-auto")}
                    >
                        {columnasDeFecha.map((c) => (
                            <option key={c.codigo} value={c.codigo}>{c.nombre.toLowerCase()}</option>
                        ))}
                    </select>
                </label>
            ) : null}
        </div>
    );
}

function filtroNuevo(c: ColumnaCatalogo): FiltroReporte {
    switch (c.filtro) {
        case "opciones":
            return { columna: c.codigo, op: "en", valores: [] };
        case "texto":
            return { columna: c.codigo, op: "contiene", valor: "" };
        case "booleano":
            return { columna: c.codigo, op: "es", valor: true };
        default:
            return { columna: c.codigo, op: "entre", desde: null, hasta: null };
    }
}

export function ElegirFiltros({
    fuente,
    receta,
    opciones,
    onCambiar,
}: {
    fuente: FuenteCatalogo;
    receta: ConfigReporte;
    opciones: Record<string, Opcion[]> | null;
    onCambiar: (r: ConfigReporte) => void;
}) {
    const porCodigo = useMemo(() => new Map(fuente.columnas.map((c) => [c.codigo, c])), [fuente]);
    const usadas = new Set(receta.filtros.map((f) => f.columna));
    const disponibles = fuente.columnas.filter((c) => c.filtro && !usadas.has(c.codigo));

    const cambiar = (i: number, f: FiltroReporte | null) => {
        const filtros = [...receta.filtros];
        if (f) filtros[i] = f;
        else filtros.splice(i, 1);
        onCambiar({ ...receta, filtros });
    };

    return (
        <div className="space-y-2">
            {receta.filtros.map((f, i) => {
                const c = porCodigo.get(f.columna);
                if (!c) return null;
                return (
                    <div key={`${f.columna}-${i}`} className="rounded-xl border border-gray-200 bg-gray-50/60 p-2.5">
                        <div className="mb-1.5 flex items-center gap-2">
                            <Filter className="h-3.5 w-3.5 text-[#DC143C]" />
                            <span className="flex-1 text-xs font-semibold text-gray-800">{c.nombre}</span>
                            <BotonIcono titulo={`Sacar el filtro «${c.nombre}»`} onClick={() => cambiar(i, null)}>
                                <X className="h-3.5 w-3.5" />
                            </BotonIcono>
                        </div>
                        <EditorDeFiltro columna={c} filtro={f} opciones={opciones?.[c.codigo] ?? null}
                                        onCambiar={(nuevo) => cambiar(i, nuevo)} />
                    </div>
                );
            })}
            {disponibles.length > 0 && (
                <label className="relative block">
                    <Plus className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#DC143C]" />
                    <select
                        value=""
                        onChange={(e) => {
                            const c = porCodigo.get(e.target.value);
                            if (c) onCambiar({ ...receta, filtros: [...receta.filtros, filtroNuevo(c)] });
                        }}
                        className={cn(SELECT, "cursor-pointer border-dashed pl-8 text-gray-600")}
                        aria-label="Agregar un filtro"
                    >
                        <option value="">Agregar un filtro…</option>
                        {disponibles.map((c) => (
                            <option key={c.codigo} value={c.codigo}>{c.nombre}</option>
                        ))}
                    </select>
                </label>
            )}
        </div>
    );
}

function EditorDeFiltro({
    columna,
    filtro,
    opciones,
    onCambiar,
}: {
    columna: ColumnaCatalogo;
    filtro: FiltroReporte;
    opciones: Opcion[] | null;
    onCambiar: (f: FiltroReporte) => void;
}) {
    if (filtro.op === "en") {
        return <ElegirValores opciones={opciones} valores={filtro.valores ?? []}
                              onCambiar={(valores) => onCambiar({ ...filtro, valores })} />;
    }
    if (filtro.op === "contiene") {
        return (
            <input
                value={String(filtro.valor ?? "")}
                onChange={(e) => onCambiar({ ...filtro, valor: e.target.value })}
                placeholder="Que contenga…"
                maxLength={100}
                className={INPUT}
            />
        );
    }
    if (filtro.op === "es") {
        return (
            <div className="inline-flex rounded-lg bg-gray-200/70 p-0.5 text-xs font-medium">
                {[true, false].map((v) => (
                    <button
                        key={String(v)}
                        type="button"
                        onClick={() => onCambiar({ ...filtro, valor: v })}
                        className={cn(
                            "rounded-md px-3 py-1 transition-colors",
                            filtro.valor === v ? "bg-white text-[#1e3a5f] shadow-sm" : "text-gray-500 hover:text-gray-700",
                        )}
                    >
                        {v ? "Sí" : "No"}
                    </button>
                ))}
            </div>
        );
    }
    const esFecha = columna.filtro === "fecha";
    const valor = (v: string) => (esFecha ? v : v === "" ? null : Number(v));
    return (
        <div className="flex items-center gap-2">
            <input
                type={esFecha ? "date" : "number"}
                value={filtro.desde ?? ""}
                onChange={(e) => onCambiar({ ...filtro, desde: valor(e.target.value) })}
                placeholder="Desde"
                className={INPUT}
                aria-label="Desde"
            />
            <span className="shrink-0 text-xs text-gray-400">a</span>
            <input
                type={esFecha ? "date" : "number"}
                value={filtro.hasta ?? ""}
                onChange={(e) => onCambiar({ ...filtro, hasta: valor(e.target.value) })}
                placeholder="Hasta"
                className={INPUT}
                aria-label="Hasta"
            />
        </div>
    );
}

const SIN_DATO = "__sin_dato__";

function ElegirValores({
    opciones,
    valores,
    onCambiar,
}: {
    opciones: Opcion[] | null;
    valores: ValorOpcion[];
    onCambiar: (v: ValorOpcion[]) => void;
}) {
    const [buscar, setBuscar] = useState("");
    const clave = (v: ValorOpcion) => (v === null ? SIN_DATO : String(v));
    const elegidos = new Set(valores.map(clave));
    const textoDe = (v: ValorOpcion) =>
        v === null ? "(sin dato)" : opciones?.find((o) => String(o.valor) === String(v))?.texto ?? `#${v}`;
    const lista = (opciones ?? []).filter((o) => o.texto.toLowerCase().includes(buscar.trim().toLowerCase()));

    const alternar = (v: ValorOpcion) =>
        onCambiar(elegidos.has(clave(v)) ? valores.filter((x) => clave(x) !== clave(v)) : [...valores, v]);

    return (
        <div className="space-y-1.5">
            <Popover>
                <PopoverTrigger asChild>
                    <button type="button" className={cn(SELECT, "flex items-center justify-between text-left")}>
                        <span className={cn("truncate", valores.length === 0 && "text-gray-400")}>
                            {valores.length === 0 ? "Elegí uno o varios…" : `${valores.length} elegido${valores.length === 1 ? "" : "s"}`}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </button>
                </PopoverTrigger>
                <Flotante align="start" className="w-[min(320px,calc(100vw-2rem))] p-0">
                    <div className="border-b border-gray-100 p-2">
                        <label className="relative block">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                            <input
                                autoFocus
                                value={buscar}
                                onChange={(e) => setBuscar(e.target.value)}
                                placeholder="Buscar"
                                className="h-8 w-full rounded-md border border-gray-200 pl-7 pr-2 text-sm focus:border-[#1e3a5f] focus:outline-none"
                            />
                        </label>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-1">
                        {opciones === null && <p className="px-2 py-3 text-xs text-gray-500">Cargando la lista…</p>}
                        {[...lista.map((o) => ({ v: o.valor as ValorOpcion, t: o.texto })), { v: null as ValorOpcion, t: "(sin dato)" }]
                            .filter((x) => x.v !== null || !buscar.trim() || "(sin dato)".includes(buscar.trim().toLowerCase()))
                            .map(({ v, t }) => (
                                <button
                                    key={clave(v)}
                                    type="button"
                                    onClick={() => alternar(v)}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                                >
                                    <span
                                        className={cn(
                                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                            elegidos.has(clave(v)) ? "border-[#DC143C] bg-[#DC143C] text-white" : "border-gray-300",
                                        )}
                                    >
                                        {elegidos.has(clave(v)) && <Check className="h-3 w-3" />}
                                    </span>
                                    <span className={cn("truncate", v === null && "italic text-gray-500")}>{t}</span>
                                </button>
                            ))}
                        {opciones !== null && lista.length === 0 && buscar.trim() && (
                            <p className="px-2 py-2 text-xs text-gray-500">Nada con «{buscar.trim()}».</p>
                        )}
                    </div>
                </Flotante>
            </Popover>
            {valores.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {valores.map((v) => (
                        <span key={clave(v)} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#1e3a5f] py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-white">
                            <span className="truncate">{textoDe(v)}</span>
                            <button type="button" onClick={() => alternar(v)} aria-label={`Sacar ${textoDe(v)}`}
                                    className="rounded-full p-0.5 hover:bg-white/20">
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────── 4. agrupar, contar y ordenar ───────────────────────────

export function ElegirAgrupacion({
    fuente,
    receta,
    onCambiar,
}: {
    fuente: FuenteCatalogo;
    receta: ConfigReporte;
    onCambiar: (r: ConfigReporte) => void;
}) {
    const agrupables = fuente.columnas.filter((c) => c.agrupable);
    const medibles = fuente.columnas.filter((c) => c.funciones.length > 0);
    const [g1, g2] = receta.agrupar;

    const agrupar = (i: 0 | 1, codigo: string) => {
        const nuevos = [...receta.agrupar];
        if (!codigo) nuevos.splice(i);
        else nuevos[i] = codigo;
        const limpio = nuevos.filter((c, j) => c && nuevos.indexOf(c) === j).slice(0, 2);
        onCambiar({
            ...receta,
            agrupar: limpio,
            medidas: receta.medidas.length ? receta.medidas : [{ funcion: "conteo" }],
            // El orden de una tabla agrupada es por lo agrupado o por una cuenta.
            orden: limpio.length ? { por: limpio[0], direccion: "asc" } : null,
        });
    };
    const medida = (i: number, m: MedidaReporte | null) => {
        const medidas = [...receta.medidas];
        if (m) medidas[i] = m;
        else medidas.splice(i, 1);
        const orden = receta.orden && /^m\d+$/.test(receta.orden.por) && Number(receta.orden.por.slice(1)) >= medidas.length
            ? null : receta.orden;
        onCambiar({ ...receta, medidas, orden });
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Agrupar por</span>
                    <select value={g1 ?? ""} onChange={(e) => agrupar(0, e.target.value)} className={SELECT}>
                        <option value="">Sin agrupar (una fila por dato)</option>
                        {agrupables.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                    </select>
                </label>
                {g1 && (
                    <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Y después por</span>
                        <select value={g2 ?? ""} onChange={(e) => agrupar(1, e.target.value)} className={SELECT}>
                            <option value="">Nada más</option>
                            {agrupables.filter((c) => c.codigo !== g1).map((c) => (
                                <option key={c.codigo} value={c.codigo}>{c.nombre}</option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            {g1 && (
                <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Qué contar en cada grupo</span>
                    {receta.medidas.map((m, i) => {
                        const posibles = medibles.filter((c) => m.funcion === "conteo" || c.funciones.includes(m.funcion));
                        return (
                            <div key={i} className="flex items-center gap-1.5">
                                <select
                                    value={m.funcion}
                                    onChange={(e) => {
                                        const funcion = e.target.value as Funcion;
                                        if (funcion === "conteo") return medida(i, { funcion });
                                        const col = medibles.find((c) => c.codigo === m.columna && c.funciones.includes(funcion))
                                            ?? medibles.find((c) => c.funciones.includes(funcion));
                                        medida(i, { funcion, columna: col?.codigo ?? null });
                                    }}
                                    className={cn(SELECT, "w-[128px] shrink-0")}
                                >
                                    {(Object.keys(NOMBRE_FUNCION) as Funcion[])
                                        .filter((f) => f === "conteo" || medibles.some((c) => c.funciones.includes(f)))
                                        .map((f) => <option key={f} value={f}>{NOMBRE_FUNCION[f]}</option>)}
                                </select>
                                {m.funcion === "conteo" ? (
                                    <span className="flex-1 truncate text-xs text-gray-500">de filas en el grupo</span>
                                ) : (
                                    <select
                                        value={m.columna ?? ""}
                                        onChange={(e) => medida(i, { ...m, columna: e.target.value })}
                                        className={SELECT}
                                    >
                                        {posibles.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                                    </select>
                                )}
                                <BotonIcono titulo="Sacar esta cuenta" onClick={() => medida(i, null)} disabled={receta.medidas.length === 1}>
                                    <X className="h-3.5 w-3.5" />
                                </BotonIcono>
                            </div>
                        );
                    })}
                    {receta.medidas.length < 8 && medibles.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                const col = medibles.find((c) => c.funciones.includes("suma")) ?? medibles[0];
                                const funcion: Funcion = col.funciones.includes("suma") ? "suma" : col.funciones[0];
                                onCambiar({ ...receta, medidas: [...receta.medidas, { funcion, columna: col.codigo }] });
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#DC143C] hover:text-[#B8112E]"
                        >
                            <Plus className="h-3.5 w-3.5" /> Otra cuenta
                        </button>
                    )}
                </div>
            )}

            <ElegirOrden fuente={fuente} receta={receta} onCambiar={onCambiar} />
        </div>
    );
}

function ElegirOrden({
    fuente,
    receta,
    onCambiar,
}: {
    fuente: FuenteCatalogo;
    receta: ConfigReporte;
    onCambiar: (r: ConfigReporte) => void;
}) {
    const agrupado = receta.agrupar.length > 0;
    const nombre = (codigo: string) => fuente.columnas.find((c) => c.codigo === codigo)?.nombre ?? codigo;
    const opciones: { valor: string; texto: string }[] = agrupado
        ? [
            ...receta.agrupar.map((c) => ({ valor: c, texto: nombre(c) })),
            ...receta.medidas.map((m, i) => ({
                valor: `m${i}`,
                texto: m.funcion === "conteo" ? "Cantidad" : `${NOMBRE_FUNCION[m.funcion]} ${nombre(m.columna ?? "").toLowerCase()}`,
            })),
        ]
        : [
            ...receta.columnas.map((c) => ({ valor: c, texto: nombre(c) })),
            ...fuente.columnas.filter((c) => !receta.columnas.includes(c.codigo))
                .map((c) => ({ valor: c.codigo, texto: `${c.nombre} (sin mostrarla)` })),
        ];
    const actual = receta.orden?.por && opciones.some((o) => o.valor === receta.orden!.por) ? receta.orden.por : "";
    const desc = receta.orden?.direccion === "desc";

    return (
        <div className="flex items-end gap-1.5">
            <label className="min-w-0 flex-1 space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Ordenar por</span>
                <select
                    value={actual}
                    onChange={(e) => onCambiar({ ...receta, orden: e.target.value ? { por: e.target.value, direccion: receta.orden?.direccion ?? "asc" } : null })}
                    className={SELECT}
                >
                    <option value="">El de siempre</option>
                    {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                </select>
            </label>
            <button
                type="button"
                disabled={!actual}
                onClick={() => actual && onCambiar({ ...receta, orden: { por: actual, direccion: desc ? "asc" : "desc" } })}
                className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-sm hover:border-[#1e3a5f] disabled:opacity-40"
                title={desc ? "De mayor a menor" : "De menor a mayor"}
            >
                {desc ? <ArrowDownWideNarrow className="h-3.5 w-3.5" /> : <ArrowUpNarrowWide className="h-3.5 w-3.5" />}
                {desc ? "Mayor a menor" : "Menor a mayor"}
            </button>
        </div>
    );
}
