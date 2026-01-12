import React from 'react';
import { Button } from "@/components/ui/button";
import { PlusCircle, Plus, X, Save, Search, Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { API_URL } from "@/config";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export function AddProcessRow({ orderId, onProcessAdded, isCentered = false, variant = 'table', label }: { orderId: number, onProcessAdded: () => void, isCentered?: boolean, variant?: 'table' | 'card', label?: string }) {
    const [isAdding, setIsAdding] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [procesos, setProcesos] = React.useState<any[]>([]);

    // List of editable items
    const [editableItems, setEditableItems] = React.useState<{ id: string, procesoId: string, tiempo: string }[]>([]);

    const fetchProcesos = async () => {
        try {
            const res = await fetch(`${API_URL}/procesos`, { headers: getAuthHeaders() });
            if (res.ok) {
                const data = await res.json();
                if (data.data && Array.isArray(data.data)) {
                    setProcesos(data.data);
                }
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleAddEmptyRow = () => {
        setEditableItems(prev => [...prev, { id: Math.random().toString(), procesoId: "", tiempo: "" }]);
    };

    const handleUpdateItem = (id: string, field: 'procesoId' | 'tiempo', value: string) => {
        setEditableItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ));
    };

    const handleRemoveItem = (id: string) => {
        setEditableItems(prev => prev.filter(item => item.id !== id));
    };

    const handleBatchSave = async () => {
        const validItems = editableItems.filter(i => i.procesoId && i.tiempo);
        if (validItems.length === 0) return;

        setLoading(true);
        try {
            const promises = validItems.map(item =>
                fetch(`${API_URL}/ordenes/${orderId}/procesos`, {
                    method: 'POST',
                    headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id_proceso: parseInt(item.procesoId),
                        tiempo_estimado: parseInt(item.tiempo) || 0,
                        orden: 99
                    })
                })
            );

            const results = await Promise.all(promises);
            const allSuccess = results.every(res => res.ok);

            if (allSuccess) {
                setEditableItems([]);
                onProcessAdded();
                setIsAdding(false);
                toast.success("Procesos guardados correctamente");
            } else {
                toast.error("Error al guardar uno o más procesos");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error al guardar los procesos");
        } finally {
            setLoading(false);
        }
    };

    if (!isAdding) {
        let buttonText = label;
        if (!buttonText) {
            buttonText = isCentered ? "Agregar primer proceso" : "Agregar Proceso";
        }

        return (
            <button
                onClick={() => {
                    setIsAdding(true);
                    fetchProcesos();
                    // Start with one empty row
                    setEditableItems([{ id: Math.random().toString(), procesoId: "", tiempo: "" }]);
                }}
                className={cn(
                    "flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors w-full px-4 py-2 hover:bg-gray-100",
                    isCentered ? "justify-center" : ""
                )}
            >
                <PlusCircle className="w-4 h-4" />
                {buttonText}
            </button>
        );
    }

    return (
        <div className={cn(
            "flex flex-col w-full animate-in fade-in slide-in-from-top-1 bg-blue-50/30 border-t border-blue-100 p-2 gap-2",
            variant === 'card' ? "rounded-lg border bg-white" : ""
        )}>
            <div className="flex justify-between items-center px-2">
                <span className="text-xs font-medium text-blue-800">Nuevos Procesos</span>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-gray-500 hover:text-red-600"
                    onClick={() => setIsAdding(false)}
                >
                    <X className="w-4 h-4" />
                </Button>
            </div>

            {editableItems.map((item, idx) => (
                <div key={item.id} className={cn(
                    "items-center gap-2",
                    variant === 'table'
                        ? "grid grid-cols-[50px_1fr_180px_120px_80px_100px_200px_200px] gap-4"
                        : "flex flex-col gap-2 w-full p-2 rounded border border-blue-100 shadow-sm transition-all"
                )}>
                    {variant === 'table' && <div className="text-right pr-2 text-xs text-gray-400">#{idx + 1}</div>}

                    {/* Process Selection */}
                    <div className={cn("flex flex-col gap-1", variant === 'card' ? "w-full" : "w-full")}>
                        {variant === 'card' && <span className="text-[10px] uppercase font-bold text-gray-400">Proceso</span>}
                        <ProcessSelector
                            value={item.procesoId}
                            onChange={(val) => handleUpdateItem(item.id, 'procesoId', val)}
                            procesos={procesos}
                        />
                    </div>

                    {variant === 'table' && <><div></div><div></div></>}

                    {/* Time Input */}
                    <div className={cn("flex flex-col gap-1", variant === 'card' ? "w-full" : "")}>
                        {variant === 'card' && <span className="text-[10px] uppercase font-bold text-gray-400">Tiempo Estimado</span>}
                        <div className="relative">
                            <Input
                                type="number"
                                className={cn("h-8 text-xs bg-white", variant === 'card' ? "w-full pr-8" : "text-center")}
                                value={item.tiempo}
                                onChange={e => handleUpdateItem(item.id, 'tiempo', e.target.value)}
                                placeholder="0"
                            />
                            {variant === 'card' && <span className="absolute right-2 top-1.5 text-xs text-gray-400 pointer-events-none">min</span>}
                        </div>
                    </div>

                    {variant === 'table' && <><div></div><div></div></>}

                    <div className={cn("flex items-center", variant === 'card' ? "justify-end mt-1" : "")}>
                        {variant === 'card' ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-red-500 hover:text-red-700 hover:bg-red-50 text-xs flex items-center gap-1"
                                onClick={() => handleRemoveItem(item.id)}
                            >
                                <X className="w-3 h-3" /> Eliminar
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                                onClick={() => handleRemoveItem(item.id)}
                                disabled={editableItems.length === 1}
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        )}
                    </div>
                </div>
            ))}

            <div className={cn("flex items-center gap-2 mt-2 px-1", variant === 'card' ? "flex-col" : "")}>
                {variant !== 'card' && (
                    <Button
                        size="sm"
                        variant="outline"
                        className={cn("h-8 text-xs gap-1 border-dashed", variant === 'card' ? "w-full justify-center" : "")}
                        onClick={handleAddEmptyRow}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Agregar otra fila
                    </Button>
                )}

                {variant !== 'card' && <div className="flex-1"></div>}

                <Button
                    size="sm"
                    className={cn(
                        "h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1 shadow-sm",
                        variant === 'card' ? "w-full justify-center" : ""
                    )}
                    onClick={handleBatchSave}
                    disabled={loading || editableItems.filter(i => i.procesoId && i.tiempo).length === 0}
                >
                    {loading ? "..." : (
                        <>
                            <Save className="w-3.5 h-3.5" />
                            {variant === 'card' ? "Guardar" : `Guardar Todo (${editableItems.filter(i => i.procesoId && i.tiempo).length})`}
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

function ProcessSelector({ value, onChange, procesos }: { value: string, onChange: (val: string) => void, procesos: any[] }) {
    const [open, setOpen] = React.useState(false)
    const [searchTerm, setSearchTerm] = React.useState("")

    const safeProcesos = Array.isArray(procesos) ? procesos : [];

    const selectedProcess = safeProcesos.find(p => p.id.toString() === value)

    const filteredProcesos = safeProcesos.filter(p =>
        p.nombre.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="h-8 w-full justify-between text-xs font-normal bg-white"
                >
                    <span className="truncate">
                        {selectedProcess ? selectedProcess.nombre : "Seleccionar Proceso..."}
                    </span>
                    <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <div className="flex flex-col w-full bg-white rounded-md">
                    <div className="flex items-center border-b px-3 py-2">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <input
                            className="flex h-9 w-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Buscar proceso..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="max-h-[300px] overflow-auto p-1">
                        {filteredProcesos.length === 0 && (
                            <div className="py-6 text-center text-sm text-muted-foreground">
                                No se encontró el proceso.
                            </div>
                        )}
                        {filteredProcesos.map((proceso) => (
                            <div
                                key={proceso.id}
                                className={cn(
                                    "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-slate-100",
                                    value === proceso.id.toString() && "bg-slate-100"
                                )}
                                onClick={() => {
                                    onChange(proceso.id.toString())
                                    setOpen(false)
                                    setSearchTerm("")
                                }}
                            >
                                <Check
                                    className={cn(
                                        "mr-2 h-4 w-4",
                                        value === proceso.id.toString() ? "opacity-100" : "opacity-0"
                                    )}
                                />
                                {proceso.nombre}
                            </div>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
