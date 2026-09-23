import React, { useState, useEffect, useRef } from "react";
import { API_URL } from "@/config";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Search, ChevronLeft, ChevronRight, Loader2, AlertTriangle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { estaBajoMinimo, formatearCantidad, leerMinimo } from "@/lib/stockMinimo";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { filtroBusqueda, type ColumnaExport } from "@/lib/exportar";

interface Pieza {
    id: number;
    cod_pieza: string;
    descripcion: string;
    unitario?: number;
    unidad?: string;
    stockactual?: number | null;
    observaciones?: string;
    proveedor?: string;
    material?: string;
    formato?: string;
    estante?: string;
    letra?: string;
    nro?: string;
    id_otvieja?: number;
    /**
     * Stock mínimo que el pañol quiere vigilar (RF-14). null = no se vigila.
     * AUSENTE (la clave ni viene) = el backend todavía es el viejo y no lo conoce: en
     * ese caso la columna y los filtros no se muestran y la solapa queda como antes.
     */
    stock_minimo?: number | null;
    stock_bajo_avisado_en?: string | null;
}

interface MetaData {
    total_count: number;
    page: number;
    size: number;
    total_pages: number;
}

/** Qué piezas mirar según su stock mínimo. Sólo existe si el backend lo sabe filtrar. */
type FiltroStock = "todas" | "con_minimo" | "bajo_minimo";

const FILTROS_STOCK: { clave: FiltroStock; rotulo: string }[] = [
    { clave: "todas", rotulo: "Todas" },
    { clave: "con_minimo", rotulo: "Con mínimo" },
    { clave: "bajo_minimo", rotulo: "Bajo mínimo" },
];

const authHeaders = (): Record<string, string> => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface MateriaPrimaTabProps {
    /** La pieza a la que lleva el aviso de stock bajo de la campanita, si se entró por ahí. */
    piezaInicial?: number | null;
    /** Se llama cuando ya se usó `piezaInicial`, para que no se vuelva a aplicar. */
    onPiezaInicialUsada?: () => void;
}

const MateriaPrimaTab = ({ piezaInicial = null, onPiezaInicialUsada }: MateriaPrimaTabProps) => {
    const [piezas, setPiezas] = useState<Pieza[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    // Pagination State
    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [meta, setMeta] = useState<MetaData | null>(null);
    const [onlyWithOT, setOnlyWithOT] = useState(false);

    /**
     * ¿El backend ya sabe de stock mínimo? Se deduce de la respuesta: si las piezas traen
     * la clave `stock_minimo` (aunque sea null), sí. El push a main publica esta pantalla
     * al instante pero el backend se deploya a mano, así que durante un rato conviven:
     * con el viejo, la columna y los filtros no aparecen y la solapa queda como estaba.
     */
    const [soportaMinimo, setSoportaMinimo] = useState(false);
    const [filtroStock, setFiltroStock] = useState<FiltroStock>("todas");
    /** Filas con un mínimo guardándose: sólo esa celda se atenúa, la lista no se tapa. */
    const [guardando, setGuardando] = useState<Record<number, boolean>>({});
    /** La pieza a la que llevó el aviso de la campanita: se resalta hasta que se busque otra cosa. */
    const [resaltada, setResaltada] = useState<number | null>(null);
    const desplazarA = useRef<number | null>(null);

    /**
     * Número del último pedido. Una respuesta que llega tarde (se tipeó rápido, o el
     * salto desde la campanita cambió la búsqueda mientras cargaba la primera página) no
     * puede pisar a la más nueva.
     */
    const ultimoPedido = useRef(0);

    // Debounce Search
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setPage(1); // Reset to page 1 on search change
        }, 500);
        return () => clearTimeout(handler);
    }, [searchTerm]);

    useEffect(() => {
        fetchPiezas();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, debouncedSearch, onlyWithOT, filtroStock]);

    /**
     * Entrar desde el aviso de stock bajo: se busca la pieza por su código —la búsqueda
     * es por texto, no por id— y se la resalta. Si no se encuentra, la solapa abre
     * normal: el aviso ya dijo qué insumo era.
     */
    useEffect(() => {
        if (!piezaInicial) return;
        let vigente = true;
        (async () => {
            try {
                const r = await fetch(`${API_URL}/piezas/${piezaInicial}`, { headers: authHeaders() });
                if (!r.ok) return;
                const cod = (await r.json())?.data?.cod_pieza;
                if (!cod || !vigente) return;
                setOnlyWithOT(false);
                setFiltroStock("todas");
                setSearchTerm(cod);
                setDebouncedSearch(cod);
                setPage(1);
                setResaltada(piezaInicial);
                desplazarA.current = piezaInicial;
            } catch {
                // Sin red o sin backend: la solapa abre como siempre.
            } finally {
                // Sólo la corrida vigente lo da por usado. En desarrollo React monta dos
                // veces: si la primera (ya cancelada) avisara, la segunda se cancelaría
                // al cambiar la prop y el salto no pasaría nunca.
                if (vigente) onPiezaInicialUsada?.();
            }
        })();
        return () => {
            vigente = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [piezaInicial]);

    // Llevar la fila resaltada a la vista UNA vez, cuando aparece. No en cada cambio de
    // la lista: si no, cargar un mínimo en otra fila la volvería a centrar.
    useEffect(() => {
        const id = desplazarA.current;
        if (!id) return;
        const fila = document.getElementById(`pieza-${id}`);
        if (fila) {
            fila.scrollIntoView({ block: "center", behavior: "smooth" });
            desplazarA.current = null;
        }
    }, [piezas]);

    const fetchPiezas = async () => {
        const estePedido = ++ultimoPedido.current;
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                size: pageSize.toString(),
                search: debouncedSearch,
                only_with_ot: onlyWithOT.toString()
            });
            // El backend viejo ignora estos parámetros y devuelve la lista entera; como
            // sus piezas no traen `stock_minimo`, abajo se apaga el filtro solo.
            if (filtroStock === "con_minimo") params.set("con_minimo", "true");
            if (filtroStock === "bajo_minimo") params.set("bajo_minimo", "true");

            const response = await fetch(`${API_URL}/piezas?${params.toString()}`, {
                headers: authHeaders()
            });

            if (estePedido !== ultimoPedido.current) return;

            if (response.ok) {
                const json = await response.json();
                if (estePedido !== ultimoPedido.current) return;
                // Backend returns: ResponseDTO(data={data: [...], total_count: ...})
                // So json.data is the payload
                const payload = json.data;

                if (payload && Array.isArray(payload.data)) {
                    setPiezas(payload.data);
                    setMeta({
                        total_count: payload.total_count,
                        page: payload.page,
                        size: payload.size,
                        total_pages: payload.total_pages
                    });
                    // Una página vacía no dice nada del backend (puede ser «bajo mínimo»
                    // sin ninguna abajo): se decide sólo con filas a la vista.
                    if (payload.data.length > 0) {
                        const soporta = payload.data.some((p: Pieza) => "stock_minimo" in p);
                        setSoportaMinimo(soporta);
                        if (!soporta && filtroStock !== "todas") setFiltroStock("todas");
                    }
                } else {
                    // Fallback if structure is different
                    setPiezas([]);
                }
            } else {
                console.error("Error fetching piezas:", response.status);
            }
        } catch (error) {
            console.error("Error fetching piezas:", error);
        } finally {
            if (estePedido === ultimoPedido.current) setLoading(false);
        }
    };

    /**
     * Guarda el mínimo de una fila. Se ve al instante y se revierte si falla: nada de
     * recargar la lista ni de un spinner que la tape.
     */
    const guardarMinimo = async (pieza: Pieza, valor: number | null) => {
        const anterior = pieza.stock_minimo ?? null;
        const cambiar = (cambios: Partial<Pieza>) =>
            setPiezas(prev => prev.map(p => (p.id === pieza.id ? { ...p, ...cambios } : p)));

        cambiar({ stock_minimo: valor });
        setGuardando(prev => ({ ...prev, [pieza.id]: true }));
        try {
            const r = await fetch(`${API_URL}/piezas/${pieza.id}/stock-minimo`, {
                method: "PUT",
                headers: { ...authHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({ stock_minimo: valor }),
            });
            let cuerpo: { data?: Partial<Pieza>; errors?: { message?: string }[] } | null = null;
            try { cuerpo = await r.json(); } catch { /* sin cuerpo */ }
            if (!r.ok) {
                // El motivo del backend nuevo viene en castellano en `errors`. Un 404/405
                // SIN ese motivo es el backend viejo, que no tiene la ruta.
                const motivo = cuerpo?.errors?.[0]?.message
                    ?? ((r.status === 404 || r.status === 405)
                        ? "el servidor todavía no tiene esta función (falta actualizar el backend)"
                        : `error ${r.status}`);
                throw new Error(motivo);
            }
            const actual = cuerpo?.data;
            if (actual && "stock_minimo" in actual) {
                cambiar({
                    stock_minimo: actual.stock_minimo ?? null,
                    stock_bajo_avisado_en: actual.stock_bajo_avisado_en ?? null,
                });
            }
        } catch (e) {
            cambiar({ stock_minimo: anterior });
            const motivo = e instanceof Error ? e.message : "no se pudo guardar";
            toast.error(`No se guardó el mínimo de ${pieza.cod_pieza}: ${motivo}`);
        } finally {
            setGuardando(prev => {
                const resto = { ...prev };
                delete resto[pieza.id];
                return resto;
            });
        }
    };

    const columnas = soportaMinimo ? 12 : 11;

    // RF-22: las columnas de la tabla. Stock, mínimo y precio van como números.
    const columnasExport: ColumnaExport<Pieza>[] = [
        { titulo: "Código", valor: (p) => p.cod_pieza },
        { titulo: "Descripción", valor: (p) => p.descripcion },
        { titulo: "Material", valor: (p) => p.material ?? "" },
        { titulo: "Formato", valor: (p) => p.formato ?? "" },
        { titulo: "Stock", tipo: "numero", valor: (p) => p.stockactual },
        ...(soportaMinimo
            ? [
                { titulo: "Mínimo", tipo: "numero", valor: (p: Pieza) => p.stock_minimo } as ColumnaExport<Pieza>,
                { titulo: "Bajo mínimo", tipo: "booleano", valor: (p: Pieza) => estaBajoMinimo(p.stockactual, p.stock_minimo) } as ColumnaExport<Pieza>,
            ]
            : []),
        { titulo: "Unidad", valor: (p) => p.unidad ?? "" },
        { titulo: "Ubicación", valor: (p) => `${p.estante || ""} ${p.letra || ""} ${p.nro || ""}`.trim() },
        { titulo: "Proveedor", valor: (p) => p.proveedor ?? "" },
        { titulo: "Precio", tipo: "moneda", valor: (p) => p.unitario ?? 0 },
        { titulo: "N° OT", tipo: "id", valor: (p) => p.id_otvieja || null },
        { titulo: "Observaciones", valor: (p) => p.observaciones ?? "" },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
                <div className="relative w-full sm:max-w-sm">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por código o descripción..."
                        className="pl-8"
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setResaltada(null);
                        }}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {soportaMinimo && (
                        <div
                            className="inline-flex rounded-md border bg-white p-0.5 shadow-sm"
                            role="group"
                            aria-label="Filtrar por stock mínimo"
                        >
                            {FILTROS_STOCK.map(f => (
                                <button
                                    key={f.clave}
                                    type="button"
                                    onClick={() => {
                                        setFiltroStock(f.clave);
                                        setPage(1);
                                    }}
                                    aria-pressed={filtroStock === f.clave}
                                    className={
                                        "rounded px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap " +
                                        (filtroStock === f.clave
                                            ? (f.clave === "bajo_minimo" ? "bg-red-700 text-white" : "bg-gray-900 text-white")
                                            : "text-gray-600 hover:bg-gray-100")
                                    }
                                >
                                    {f.rotulo}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center space-x-2 bg-white p-2 rounded-md border shadow-sm">
                        <Checkbox
                            id="only-ot"
                            checked={onlyWithOT}
                            onCheckedChange={(checked) => {
                                setOnlyWithOT(!!checked);
                                setPage(1);
                            }}
                        />
                        <Label htmlFor="only-ot" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                            Solo con OT asignada
                        </Label>
                    </div>
                </div>

            </div>

            {/* Sin marco propio: la pantalla de Operaciones ya es la caja. El card
                acá adentro era una caja blanca arriba de otra caja blanca. */}
            <Card className="border-0 shadow-none py-0 gap-4">
                <CardHeader className="dir-row justify-between items-center px-0 pb-0">
                    <div>
                        <CardTitle>Inventario de Materia Prima</CardTitle>
                        <CardDescription>
                            {meta ? `Mostrando ${piezas.length} de ${meta.total_count} registros` : 'Gestión de piezas'}
                        </CardDescription>
                        {soportaMinimo && (
                            <p className="mt-1 text-xs text-gray-500">
                                Tocá la columna <span className="font-medium">Mínimo</span> para cargar
                                el stock mínimo de un insumo. Cuando el stock queda abajo, avisa la campanita.
                            </p>
                        )}
                    </div>
                    {meta && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            {/* RF-22: sale la página que se está viendo, con su búsqueda. La
                                lista viene de a 50 del servidor y exportar no pide nada más. */}
                            <ExportarMenu
                                titulo="Inventario de materia prima"
                                archivo="materia_prima"
                                filas={piezas}
                                columnas={columnasExport}
                                disabled={loading}
                                filtros={() => [
                                    ...filtroBusqueda(debouncedSearch),
                                    ...(onlyWithOT ? ["Sólo con OT asignada"] : []),
                                    ...(filtroStock !== "todas" ? [`Stock: ${FILTROS_STOCK.find(f => f.clave === filtroStock)?.rotulo}`] : []),
                                    ...(meta.total_pages > 1 ? [`Página ${meta.page} de ${meta.total_pages} (${piezas.length} de ${meta.total_count} registros)`] : []),
                                ]}
                                aviso={meta.total_pages > 1
                                    ? `Sale la página que estás viendo: ${piezas.length} de ${meta.total_count.toLocaleString("es-AR")}. Para otra parte, pasá de página o buscá.`
                                    : undefined}
                            />
                            <span>Página {meta.page} de {meta.total_pages}</span>
                            <div className="flex gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    disabled={page <= 1 || loading}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    disabled={page >= meta.total_pages || loading}
                                    onClick={() => setPage(p => p + 1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardHeader>
                <CardContent className="px-0">
                    {/* `min-w-[1100px]` abajo de `lg` (RF-27): son doce columnas y en un
                        teléfono se apretaban a 340px — la descripción partida letra por
                        letra y el mínimo editable sin lugar para tocarlo. Con piso, la tabla
                        se desliza de costado dentro de su borde. Desde `lg` queda como
                        estaba: se acomoda al ancho que haya.
                        El `@container` es para los carteles de «Cargando» y «No se
                        encontraron»: van del ancho de la caja y pegados a la izquierda,
                        porque centrados en los 1100px quedaban fuera de la pantalla. */}
                    <div className="rounded-md border @container">
                        <Table className="min-w-[1100px] lg:min-w-0">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Código</TableHead>
                                    <TableHead className="w-[20%]">Descripción</TableHead>
                                    <TableHead>Material</TableHead>
                                    <TableHead>Formato</TableHead>
                                    <TableHead>Stock</TableHead>
                                    {soportaMinimo && <TableHead>Mínimo</TableHead>}
                                    <TableHead>Unidad</TableHead>
                                    <TableHead>Ubicación</TableHead>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Precio</TableHead>
                                    <TableHead>Nº OT (id_otvieja)</TableHead>
                                    <TableHead className="max-w-[150px]">Obs</TableHead>

                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={columnas} className="p-0">
                                            <div className="sticky left-0 w-[100cqw] h-24 flex justify-center items-center gap-2">
                                                <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                                                <span>Cargando datos...</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : piezas.length > 0 ? (
                                    piezas.map((pieza) => {
                                        const bajo = soportaMinimo && estaBajoMinimo(pieza.stockactual, pieza.stock_minimo);
                                        return (
                                            <TableRow
                                                key={pieza.id}
                                                id={`pieza-${pieza.id}`}
                                                className={pieza.id === resaltada ? "bg-amber-50 hover:bg-amber-50" : undefined}
                                            >
                                                <TableCell className="font-medium text-xs">{pieza.cod_pieza}</TableCell>
                                                <TableCell className="text-xs">{pieza.descripcion}</TableCell>
                                                <TableCell className="text-xs text-gray-500">{pieza.material || '-'}</TableCell>
                                                <TableCell className="text-xs text-gray-500">{pieza.formato || '-'}</TableCell>
                                                <TableCell className="text-xs whitespace-nowrap">
                                                    {bajo ? (
                                                        <span
                                                            className="inline-flex items-center gap-1 font-semibold text-red-700"
                                                            title={`Abajo del mínimo (${formatearCantidad(pieza.stock_minimo)})`}
                                                        >
                                                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                                                            {formatearCantidad(pieza.stockactual)}
                                                            <span className="sr-only">, abajo del mínimo</span>
                                                        </span>
                                                    ) : (
                                                        formatearCantidad(pieza.stockactual)
                                                    )}
                                                </TableCell>
                                                {soportaMinimo && (
                                                    <TableCell className="text-xs">
                                                        <CeldaMinimo
                                                            pieza={pieza}
                                                            guardando={!!guardando[pieza.id]}
                                                            onGuardar={(valor) => guardarMinimo(pieza, valor)}
                                                        />
                                                    </TableCell>
                                                )}
                                                <TableCell className="text-xs">{pieza.unidad}</TableCell>
                                                <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                                                    {`${pieza.estante || ''} ${pieza.letra || ''} ${pieza.nro || ''}`.trim() || '-'}
                                                </TableCell>
                                                <TableCell className="text-xs text-gray-500">{pieza.proveedor || '-'}</TableCell>
                                                <TableCell className="text-xs text-right">${pieza.unitario || 0}</TableCell>
                                                <TableCell className="text-xs text-gray-500">{pieza.id_otvieja ? `#${pieza.id_otvieja}` : '-'}</TableCell>
                                                <TableCell className="text-xs text-gray-500 max-w-[150px] truncate" title={pieza.observaciones || ''}>{pieza.observaciones || '-'}</TableCell>

                                            </TableRow>
                                        );
                                    })
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={columnas} className="p-0">
                                            <div className="sticky left-0 w-[100cqw] px-4 py-6 text-center text-muted-foreground whitespace-normal">
                                                {filtroStock === "bajo_minimo"
                                                    ? "Ningún insumo está abajo de su mínimo"
                                                    : filtroStock === "con_minimo"
                                                        ? "Todavía no hay insumos con stock mínimo cargado"
                                                        : "No se encontraron piezas"}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

/**
 * El stock mínimo de una fila, editable en línea. Se toca, se escribe, Enter (o tocar
 * afuera) guarda y Escape deja todo como estaba. Vacío = quitar el mínimo: la pieza
 * deja de vigilarse.
 */
function CeldaMinimo({
    pieza,
    guardando,
    onGuardar,
}: {
    pieza: Pieza;
    guardando: boolean;
    onGuardar: (valor: number | null) => void;
}) {
    const [editando, setEditando] = useState(false);
    const [texto, setTexto] = useState("");
    // Enter cierra el campo y, al desmontarse, algunos navegadores disparan además el
    // blur: sin esta marca se guardaría dos veces.
    const cerrado = useRef(false);

    const abrir = () => {
        cerrado.current = false;
        setTexto(pieza.stock_minimo == null ? "" : String(pieza.stock_minimo).replace(".", ","));
        setEditando(true);
    };

    const confirmar = () => {
        if (cerrado.current) return;
        cerrado.current = true;
        setEditando(false);
        const valor = leerMinimo(texto);
        if (valor === undefined) {
            toast.error("El mínimo tiene que ser un número de 0 para arriba. Vacío = no se vigila.");
            return;
        }
        if (valor === (pieza.stock_minimo ?? null)) return; // no cambió nada
        onGuardar(valor);
    };

    const cancelar = () => {
        cerrado.current = true;
        setEditando(false);
    };

    if (editando) {
        return (
            <Input
                autoFocus
                inputMode="decimal"
                value={texto}
                placeholder="Sin mínimo"
                aria-label={`Stock mínimo de ${pieza.cod_pieza}`}
                onChange={(e) => setTexto(e.target.value)}
                onBlur={confirmar}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        confirmar();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelar();
                    }
                }}
                className="h-8 w-24 px-2 text-xs"
            />
        );
    }

    return (
        <button
            type="button"
            onClick={abrir}
            disabled={guardando}
            title="Tocá para cambiar el stock mínimo. Vacío = no se vigila."
            className={
                "group inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded px-1.5 py-1 -mx-1.5 text-left hover:bg-gray-100 " +
                (guardando ? "opacity-50" : "")
            }
        >
            {pieza.stock_minimo == null ? (
                <span className="text-gray-400">Sin mínimo</span>
            ) : (
                <span className="font-medium text-gray-900">{formatearCantidad(pieza.stock_minimo)}</span>
            )}
            <Pencil className="h-3 w-3 text-gray-300 group-hover:text-gray-500" aria-hidden />
        </button>
    );
}

export default MateriaPrimaTab;
