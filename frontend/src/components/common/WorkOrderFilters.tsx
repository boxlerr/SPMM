import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkOrder } from "@/lib/types";

export interface WorkOrderFilterState {
    priority: string[];
    client: string[];
    sector: string;
    material: string;
    promisedDate: string;
    batchSize: string;
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
    showClaimsOnly: false,
    showDelayedOnly: false,
    showWithProcessesOnly: false,
};

interface WorkOrderFiltersProps {
    filters: WorkOrderFilterState;
    setFilters: React.Dispatch<React.SetStateAction<WorkOrderFilterState>>;
    orders: WorkOrder[];
}

export function WorkOrderFilters({ filters, setFilters, orders }: WorkOrderFiltersProps) {
    const [clientSearchTerm, setClientSearchTerm] = useState("");

    const uniqueClients = Array.from(new Set(orders.map(o => o.cliente?.nombre).filter((n): n is string => !!n))).sort();
    const uniqueSectors = Array.from(new Set(orders.map(o => o.sector?.nombre).filter((n): n is string => !!n))).sort();

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

    return (
        <div className="px-4 py-3 bg-slate-50/80 rounded-xl border border-gray-100 shadow-sm space-y-3 mb-4 mt-2">
            {/* Row 1: Unified Priority & Status Toggles */}
            <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Prioridad:</span>
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

                <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setFilters(prev => ({ ...prev, showWithProcessesOnly: !prev.showWithProcessesOnly }))}>
                        <div className={cn(
                            "w-7 h-3.5 rounded-full p-0.5 transition-colors",
                            filters.showWithProcessesOnly ? "bg-green-500" : "bg-slate-300"
                        )}>
                            <div className={cn(
                                "w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform",
                                filters.showWithProcessesOnly ? "translate-x-3" : "translate-x-0"
                            )} />
                        </div>
                        <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Procesos</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setFilters(prev => ({ ...prev, showDelayedOnly: !prev.showDelayedOnly }))}>
                        <div className={cn(
                            "w-7 h-3.5 rounded-full p-0.5 transition-colors",
                            filters.showDelayedOnly ? "bg-red-500" : "bg-slate-300"
                        )}>
                            <div className={cn(
                                "w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform",
                                filters.showDelayedOnly ? "translate-x-3" : "translate-x-0"
                            )} />
                        </div>
                        <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Retrasadas</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setFilters(prev => ({ ...prev, showClaimsOnly: !prev.showClaimsOnly }))}>
                        <div className={cn(
                            "w-7 h-3.5 rounded-full p-0.5 transition-colors",
                            filters.showClaimsOnly ? "bg-orange-500" : "bg-slate-300"
                        )}>
                            <div className={cn(
                                "w-2.5 h-2.5 bg-white rounded-full shadow-sm transition-transform",
                                filters.showClaimsOnly ? "translate-x-3" : "translate-x-0"
                            )} />
                        </div>
                        <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Reclamos</span>
                    </label>
                </div>
            </div>

            {/* Row 2: Symmetric Grid of All Selectors */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {/* Client Selector */}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-between bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                            <span className="truncate">
                                {filters.client.length === 0 ? "Cliente: Todos" : filters.client.length === 1 ? filters.client[0] : `${filters.client.length} Selecc.`}
                            </span>
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

                <Select value={filters.sector} onValueChange={(v) => setFilters(prev => ({...prev, sector: v}))}>
                    <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                        <SelectValue placeholder="Sector" />
                    </SelectTrigger>
                    <SelectContent><SelectItem value="ALL" className="text-xs">Sector: Todos</SelectItem>{uniqueSectors.map(s => (<SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>))}</SelectContent>
                </Select>

                <Select value={filters.material} onValueChange={(v) => setFilters(prev => ({...prev, material: v}))}>
                    <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                        <SelectValue placeholder="Material" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL" className="text-xs">Material: Todos</SelectItem>
                        <SelectItem value="OK" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500" />Disponible</div></SelectItem>
                        <SelectItem value="PEDIDO" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" />Pedido</div></SelectItem>
                        <SelectItem value="SIN_STOCK" className="text-xs"><div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-500" />Sin Stock</div></SelectItem>
                    </SelectContent>
                </Select>

                <Select value={filters.promisedDate} onValueChange={(v) => setFilters(prev => ({...prev, promisedDate: v}))}>
                    <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                        <SelectValue placeholder="Entrega" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL" className="text-xs">Entrega: Todas</SelectItem>
                        <SelectItem value="THIS_WEEK" className="text-xs">Esta semana</SelectItem>
                        <SelectItem value="NEXT_2_WEEKS" className="text-xs">Próx. 2 semanas</SelectItem>
                        <SelectItem value="THIS_MONTH" className="text-xs">Este mes</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={filters.batchSize} onValueChange={(v) => setFilters(prev => ({...prev, batchSize: v}))}>
                    <SelectTrigger className="bg-white h-8 text-[11px] px-2.5 border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all font-normal">
                        <SelectValue placeholder="Unidades" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL" className="text-xs">Lote: Todos</SelectItem>
                        <SelectItem value="SMALL" className="text-xs">Pequeño (≤10)</SelectItem>
                        <SelectItem value="MEDIUM" className="text-xs">Mediano (11-50)</SelectItem>
                        <SelectItem value="LARGE" className="text-xs">Grande ({">"}50)</SelectItem>
                    </SelectContent>
                </Select>
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
