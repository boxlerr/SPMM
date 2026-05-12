import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Search, Info, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkOrder } from "@/lib/types";

export interface WorkOrderFilterState {
    priority: string[];
    client: string[];
    sector: string;
    material: string;
    promisedDate: string;
    batchSize: string;
    dateFrom: string;
    dateTo: string;
    showClaimsOnly: boolean;
    showDelayedOnly: boolean;
    showWithProcessesOnly: boolean;
}

export const initialFilterState: WorkOrderFilterState = {
    priority: [],
    client: [],
    sector: 'ALL',
    material: 'ALL',
    promisedDate: 'ALL',
    batchSize: 'ALL',
    dateFrom: '',
    dateTo: '',
    showClaimsOnly: false,
    showDelayedOnly: false,
    showWithProcessesOnly: false,
};

interface WorkOrderFiltersProps {
    filters: WorkOrderFilterState;
    setFilters: React.Dispatch<React.SetStateAction<WorkOrderFilterState>>;
    orders: WorkOrder[];
    children?: React.ReactNode;
}

export function WorkOrderFilters({ filters, setFilters, orders, children }: WorkOrderFiltersProps) {
    const [clientSearchTerm, setClientSearchTerm] = useState("");

    const uniqueClients = Array.from(new Set(orders.map(o => o.cliente?.nombre).filter((n): n is string => !!n))).sort();
    const uniqueSectors = Array.from(new Set(orders.map(o => o.sector?.nombre).filter((n): n is string => !!n))).sort();
    
    const hasFiltersActive = 
        filters.priority.length > 0 ||
        filters.client.length > 0 ||
        filters.sector !== 'ALL' ||
        filters.material !== 'ALL' ||
        filters.promisedDate !== 'ALL' ||
        filters.batchSize !== 'ALL' ||
        filters.dateFrom !== '' ||
        filters.dateTo !== '' ||
        filters.showClaimsOnly ||
        filters.showDelayedOnly ||
        filters.showWithProcessesOnly;

    const filteredClients = uniqueClients.filter(c =>
        c.toLowerCase().includes(clientSearchTerm.toLowerCase())
    );

    const togglePriority = (p: string) => {
        setFilters(prev => ({
            ...prev,
            priority: prev.priority.includes(p) ? prev.priority.filter(x => x !== p) : [...prev.priority, p]
        }));
    };

    const toggleClient = (c: string) => {
        setFilters(prev => ({
            ...prev,
            client: prev.client.includes(c) ? prev.client.filter(x => x !== c) : [...prev.client, c]
        }));
    };

    /**
     * Renderiza la etiqueta del trigger de un select como "Categoría: valor",
     * con la categoría en gris claro y el valor en negrita cuando hay un filtro
     * aplicado (no es "Todos"). Esto evita que al elegir, por ejemplo, Material →
     * "Disponible" la palabra "Material" desaparezca y se pierda contexto.
     */
    const triggerLabel = (category: string, currentLabel: string, isDefault: boolean) => (
        <span className="truncate">
            <span className="text-slate-500 font-normal">{category}: </span>
            <span className={cn(isDefault ? "text-slate-500 font-normal" : "font-semibold text-slate-800")}>
                {currentLabel}
            </span>
        </span>
    );

    /** Diccionarios de etiquetas para mapear value → label legible. */
    const MATERIAL_LABELS: Record<string, string> = { ALL: "Todos", OK: "Disponible", PEDIDO: "Pedido", SIN_STOCK: "Sin Stock" };
    const PROMISED_LABELS: Record<string, string> = { ALL: "Todas", THIS_WEEK: "Esta semana", NEXT_2_WEEKS: "Próx. 2 semanas", THIS_MONTH: "Este mes" };
    const BATCH_LABELS: Record<string, string> = { ALL: "Todos", SMALL: "Pequeño", MEDIUM: "Mediano", LARGE: "Grande" };

    // Helper para no repetir el JSX de cada toggle (Procesos / Retrasadas / Reclamos).
    // Acepta un color (verde/rojo/naranja) y un setter directo a la key del filtro.
    const renderToggle = (
        label: string,
        active: boolean,
        onToggle: () => void,
        activeColor: string,
    ) => (
        <label className="flex items-center gap-1.5 cursor-pointer group select-none" onClick={onToggle}>
            <div className={cn(
                "w-7 h-3.5 rounded-full p-0.5 transition-colors",
                active ? activeColor : "bg-slate-300"
            )}>
                <div className={cn(
                    "w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform",
                    active ? "translate-x-3" : "translate-x-0"
                )} />
            </div>
            <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900 transition-colors">{label}</span>
        </label>
    );

    return (
        <div className="px-4 py-3 bg-slate-50/80 rounded-xl border border-gray-100 shadow-sm space-y-2.5 mb-4 mt-2">
            {/* Fila 1: prioridad + toggles + colores + limpiar (todo alineado a una sola línea con
                separadores verticales para agrupar visualmente). Limpiar Filtros queda a la derecha
                pero pegado al grupo Colores (no flotando con ml-auto que generaba un hueco enorme). */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* Prioridad */}
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Prioridad</span>
                    <div className="flex bg-slate-200/50 p-0.5 rounded-lg border border-slate-200">
                        <button
                            onClick={() => setFilters(prev => ({ ...prev, priority: [] }))}
                            className={cn(
                                "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all",
                                filters.priority.length === 0 ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            )}
                        >
                            Todas
                        </button>
                        {(['URGENTE', 'URGENTE 1', 'URGENTE 2', 'NORMAL'] as const).map(option => (
                            <button
                                key={option}
                                onClick={() => togglePriority(option)}
                                className={cn(
                                    "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all",
                                    filters.priority.includes(option) ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                )}
                            >
                                {option === 'URGENTE' ? 'URG' : option}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="hidden md:block h-5 w-px bg-slate-300" />

                {/* Toggles compactos en un solo grupo */}
                <div className="flex items-center gap-3 px-2 py-1 bg-white/60 rounded-lg border border-slate-200/70">
                    {renderToggle("Procesos", filters.showWithProcessesOnly,
                        () => setFilters(prev => ({ ...prev, showWithProcessesOnly: !prev.showWithProcessesOnly })),
                        "bg-green-500")}
                    {renderToggle("Retrasadas", filters.showDelayedOnly,
                        () => setFilters(prev => ({ ...prev, showDelayedOnly: !prev.showDelayedOnly })),
                        "bg-red-500")}
                    {renderToggle("Reclamos", filters.showClaimsOnly,
                        () => setFilters(prev => ({ ...prev, showClaimsOnly: !prev.showClaimsOnly })),
                        "bg-orange-500")}
                </div>

                <div className="hidden md:block h-5 w-px bg-slate-300" />

                {/* Leyenda de colores */}
                <Popover>
                    <PopoverTrigger asChild>
                        <button className="flex items-center gap-1.5 px-2 py-1 bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 rounded border border-slate-200 transition-colors text-[10px] font-bold tracking-wide uppercase">
                            <Info className="w-3 h-3" />
                            Colores
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[320px] p-3 text-xs shadow-xl border-slate-200" side="bottom" sideOffset={8}>
                        <h4 className="font-bold text-slate-800 mb-2 uppercase text-[10px] tracking-wider pb-2 border-b border-slate-100">Leyenda de Estados</h4>
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded shadow-sm bg-purple-200 border border-purple-300"></div> <span className="text-slate-600 font-medium">Tercerizado <span className="text-slate-400 font-normal">(Total/Parcial)</span></span></div>
                            <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded shadow-sm bg-orange-200 border border-orange-300"></div> <span className="text-slate-600 font-medium">En Producción</span></div>
                            <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded shadow-sm bg-emerald-300 border border-emerald-400"></div> <span className="text-slate-600 font-medium">Programada</span></div>
                            <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded shadow-sm bg-green-100 border border-green-200"></div> <span className="text-slate-600 font-medium">Material Disponible <span className="text-slate-400 font-normal">(Para Programar)</span></span></div>
                            <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded shadow-sm bg-yellow-100 border border-yellow-200"></div> <span className="text-slate-600 font-medium">Material pedido al Proveedor</span></div>
                            <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded shadow-sm bg-gray-100 border border-gray-200"></div> <span className="text-slate-600 font-medium">Completa para pedir Materiales <span className="text-slate-400 font-normal">(Sin Stock)</span></span></div>
                        </div>
                    </PopoverContent>
                </Popover>

                {/* Limpiar filtros — pegado al lado derecho, sin hueco grande. */}
                {hasFiltersActive && (
                    <button
                        onClick={() => setFilters(initialFilterState)}
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded border border-orange-200 transition-colors text-[10px] font-bold tracking-wide uppercase animate-in fade-in slide-in-from-right-1 duration-200 shadow-sm"
                    >
                        <X className="w-3 h-3" />
                        Limpiar Filtros
                    </button>
                )}
            </div>

            {/* Fila 2: selectores en flex-wrap. Cada uno tiene un ancho mínimo y máximo
                consistentes para que NO se estiren a llenar columnas (eso generaba huecos
                grandes en pantallas anchas). Quedan pegados uno al lado del otro con gap uniforme
                y wrappan naturalmente cuando no entran. La clase `[&>*]:` aplica el sizing
                a todos los hijos directos sin repetirlo en cada Select. */}
            <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:min-w-[160px] [&>*]:max-w-[200px]">
                {/* Client Selector */}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-between bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                            {triggerLabel(
                                "Cliente",
                                filters.client.length === 0
                                    ? "Todos"
                                    : filters.client.length === 1
                                        ? filters.client[0]
                                        : `${filters.client.length} seleccionados`,
                                filters.client.length === 0,
                            )}
                            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[280px] p-0 shadow-xl border-slate-200" align="start">
                        <div className="flex flex-col w-full bg-white rounded-md">
                            <div className="flex items-center border-b px-2.5 py-2 bg-slate-50/50">
                                <Search className="mr-2 h-3.5 w-3.5 shrink-0 opacity-40" />
                                <input
                                    className="flex h-7 w-full rounded-md bg-transparent text-sm outline-none placeholder:text-slate-400"
                                    placeholder="Filtrar clientes..."
                                    value={clientSearchTerm}
                                    onChange={(e) => setClientSearchTerm(e.target.value)}
                                />
                            </div>
                            <div className="max-h-[250px] overflow-auto p-1.5 space-y-0.5">
                                <div
                                    className="relative flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-xs hover:bg-slate-100 transition-colors"
                                    onClick={() => setFilters(prev => ({ ...prev, client: [] }))}
                                >
                                    <div className={cn(
                                        "mr-2.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-slate-300",
                                        filters.client.length === 0 ? "bg-slate-900 border-slate-900 text-white" : "text-transparent"
                                    )}>
                                        <Check className="h-3 w-3" />
                                    </div>
                                    Todos los clientes
                                </div>
                                {filteredClients.map((client) => (
                                    <div
                                        key={client}
                                        className="relative flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-xs hover:bg-slate-100 transition-colors"
                                        onClick={() => toggleClient(client)}
                                    >
                                        <div className={cn(
                                            "mr-2.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-slate-300",
                                            filters.client.includes(client) ? "bg-slate-900 border-slate-900 text-white" : "text-transparent"
                                        )}>
                                            <Check className="h-3 w-3" />
                                        </div>
                                        <span className="truncate">{client}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>

                <Select value={filters.sector} onValueChange={(v) => setFilters(prev => ({ ...prev, sector: v }))}>
                    <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal [&>span:first-child]:flex-1 [&>span:first-child]:truncate">
                        {triggerLabel("Sector", filters.sector === "ALL" ? "Todos" : filters.sector, filters.sector === "ALL")}
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL" className="text-xs">Todos</SelectItem>
                        {uniqueSectors.map(s => (<SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>))}
                    </SelectContent>
                </Select>

                <Select value={filters.material} onValueChange={(v) => setFilters(prev => ({ ...prev, material: v }))}>
                    <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal [&>span:first-child]:flex-1 [&>span:first-child]:truncate">
                        {triggerLabel("Material", MATERIAL_LABELS[filters.material] || "Todos", filters.material === "ALL")}
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL" className="text-xs">Todos</SelectItem>
                        <SelectItem value="OK" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500" />Disponible</div></SelectItem>
                        <SelectItem value="PEDIDO" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" />Pedido</div></SelectItem>
                        <SelectItem value="SIN_STOCK" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-500" />Sin Stock</div></SelectItem>
                    </SelectContent>
                </Select>

                <Select value={filters.promisedDate} onValueChange={(v) => setFilters(prev => ({ ...prev, promisedDate: v }))}>
                    <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal [&>span:first-child]:flex-1 [&>span:first-child]:truncate">
                        {triggerLabel("Entrega", PROMISED_LABELS[filters.promisedDate] || "Todas", filters.promisedDate === "ALL")}
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL" className="text-xs">Todas</SelectItem>
                        <SelectItem value="THIS_WEEK" className="text-xs">Esta semana</SelectItem>
                        <SelectItem value="NEXT_2_WEEKS" className="text-xs">Próx. 2 semanas</SelectItem>
                        <SelectItem value="THIS_MONTH" className="text-xs">Este mes</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={filters.batchSize} onValueChange={(v) => setFilters(prev => ({ ...prev, batchSize: v }))}>
                    <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal [&>span:first-child]:flex-1 [&>span:first-child]:truncate">
                        {triggerLabel("Lote", BATCH_LABELS[filters.batchSize] || "Todos", filters.batchSize === "ALL")}
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL" className="text-xs">Todos</SelectItem>
                        <SelectItem value="SMALL" className="text-xs">Pequeño (≤10)</SelectItem>
                        <SelectItem value="MEDIUM" className="text-xs">Mediano (11-50)</SelectItem>
                        <SelectItem value="LARGE" className="text-xs">Grande ({">"}50)</SelectItem>
                    </SelectContent>
                </Select>

                {/* Custom Date Range Filter */}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-between bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                            {(() => {
                                const isDefault = !filters.dateFrom && !filters.dateTo;
                                const formatStr = (d: string) => {
                                    if (!d) return "";
                                    const [y, m, day] = d.split('-');
                                    return `${day}/${m}/${y.slice(2)}`;
                                };
                                let value = "Todas";
                                if (filters.dateFrom && filters.dateTo) {
                                    value = filters.dateFrom === filters.dateTo
                                        ? formatStr(filters.dateFrom)
                                        : `${formatStr(filters.dateFrom)} → ${formatStr(filters.dateTo)}`;
                                } else if (filters.dateFrom) {
                                    value = `desde ${formatStr(filters.dateFrom)}`;
                                } else if (filters.dateTo) {
                                    value = `hasta ${formatStr(filters.dateTo)}`;
                                }
                                return triggerLabel("Fecha", value, isDefault);
                            })()}
                            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-40" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3 shadow-xl border-slate-200" align="start">
                        <div className="space-y-3">
                            <h4 className="font-semibold text-xs text-slate-800 uppercase tracking-widest border-b pb-1">Filtrar por Fecha</h4>
                            <div className="space-y-1.5">
                                <label className="text-[10px] uppercase font-bold text-slate-500">Desde (Ingreso/Promesa)</label>
                                <input 
                                    type="date" 
                                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20"
                                    value={filters.dateFrom}
                                    onChange={e => setFilters(prev => ({...prev, dateFrom: e.target.value}))}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] uppercase font-bold text-slate-500">Hasta (Ingreso/Promesa)</label>
                                <input 
                                    type="date" 
                                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20"
                                    value={filters.dateTo}
                                    onChange={e => setFilters(prev => ({...prev, dateTo: e.target.value}))}
                                />
                            </div>
                            {(filters.dateFrom || filters.dateTo) && (
                                <Button 
                                    variant="ghost" 
                                    className="w-full h-7 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 mt-2"
                                    onClick={() => setFilters(prev => ({...prev, dateFrom: '', dateTo: ''}))}
                                >
                                    Limpiar Fechas
                                </Button>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>

                {children}
            </div>
        </div>
    );
}

export function applyWorkOrderFilters(orders: WorkOrder[], filters: WorkOrderFilterState): WorkOrder[] {
    return orders.filter(order => {
        // Priority
        if (filters.priority.length > 0) {
            const p = order.prioridad?.descripcion?.toLowerCase() || ''
            const matchesPriority = filters.priority.some(filter => {
                if (filter === 'URGENTE') return p === 'urgente';
                if (filter === 'URGENTE 1') return p.includes('urgente 1') || p === 'urgente 1';
                if (filter === 'URGENTE 2') return p.includes('urgente 2') || p === 'urgente 2';
                if (filter === 'NORMAL') return p.includes('normal');
                return false;
            });
            if (!matchesPriority) return false;
        }

        // Client
        if (filters.client.length > 0) {
            const clientName = order.cliente?.nombre || '';
            if (!filters.client.includes(clientName)) return false;
        }

        // Sector
        if (filters.sector !== 'ALL') {
            if (order.sector?.nombre !== filters.sector) return false
        }

        // Claims Filter
        if (filters.showClaimsOnly) {
            if (!order.reclamo || order.reclamo === 0) return false
        }

        // Material Status Filter
        if (filters.material !== 'ALL') {
            const estado = order.estado_material || 'sin_datos'
            if (filters.material === 'OK' && estado !== 'ok') return false
            if (filters.material === 'PEDIDO' && estado !== 'pedido') return false
            if (filters.material === 'SIN_STOCK' && estado !== 'sin_stock' && estado !== 'sin_datos') return false
        }

        // Promised Date Filter
        if (filters.promisedDate !== 'ALL') {
            const promisedDate = order.fecha_prometida ? new Date(order.fecha_prometida) : null
            if (!promisedDate) return false

            const today = new Date()
            today.setHours(0, 0, 0, 0)

            const endOfWeek = new Date(today)
            endOfWeek.setDate(today.getDate() + (7 - today.getDay()))

            const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

            const nextWeekEnd = new Date(today)
            nextWeekEnd.setDate(today.getDate() + 14)

            if (filters.promisedDate === 'THIS_WEEK') {
                if (promisedDate < today || promisedDate > endOfWeek) return false
            }
            if (filters.promisedDate === 'THIS_MONTH') {
                if (promisedDate < today || promisedDate > endOfMonth) return false
            }
            if (filters.promisedDate === 'NEXT_2_WEEKS') {
                if (promisedDate < today || promisedDate > nextWeekEnd) return false
            }
        }

        // Exact Date Range Filter (checks if fecha_entrada or fecha_prometida falls entirely within the selected range)
        if (filters.dateFrom || filters.dateTo) {
            const dateIn = order.fecha_entrada ? new Date(order.fecha_entrada) : null;
            const dateProm = order.fecha_prometida ? new Date(order.fecha_prometida) : null;
            
            const fromTime = filters.dateFrom ? new Date(filters.dateFrom).getTime() : null;
            let toTime = null;
            if (filters.dateTo) {
                // Add 24h to include the entire day of 'dateTo', but handle local timezone offset cleanly
                const toDateObj = new Date(filters.dateTo);
                // Depending on the format 'YYYY-MM-DD', new Date() parses as UTC. 
                // We add exactly 24 hours - 1 ms to it to cover the day in UTC.
                toDateObj.setUTCHours(23, 59, 59, 999);
                toTime = toDateObj.getTime();
            }

            const checkDateInRange = (d: Date | null) => {
                if (!d) return false;
                const t = d.getTime();
                if (fromTime !== null && t < fromTime) return false;
                if (toTime !== null && t > toTime) return false;
                return true;
            };

            const inMatches = checkDateInRange(dateIn);
            const promMatches = checkDateInRange(dateProm);

            if (!inMatches && !promMatches) return false;
        }

        // Delayed Orders Filter
        if (filters.showDelayedOnly) {
            const promisedDate = order.fecha_prometida ? new Date(order.fecha_prometida) : null
            if (!promisedDate) return false
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            if (promisedDate >= today) return false
        }

        // Has Processes Filter
        if (filters.showWithProcessesOnly) {
            if (!order.procesos || order.procesos.length === 0) return false
        }

        // Batch Size Filter
        if (filters.batchSize !== 'ALL') {
            const units = order.unidades || 0
            if (filters.batchSize === 'SMALL' && units > 10) return false
            if (filters.batchSize === 'MEDIUM' && (units <= 10 || units > 50)) return false
            if (filters.batchSize === 'LARGE' && units <= 50) return false
        }

        return true
    })
}
