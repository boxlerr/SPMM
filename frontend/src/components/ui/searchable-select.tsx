"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ChevronDown, Check, Search, X } from "lucide-react";

interface SearchableSelectProps {
    options: { value: string; label: string }[];
    value?: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
}

interface MenuPosition {
    /** desplazamiento izquierdo relativo al contenedor del portal */
    left: number;
    width: number;
    /** true = el menú se abre hacia arriba (no había espacio abajo) */
    openUp: boolean;
    maxHeight: number;
    /** ancla vertical relativa al portal: top si abre hacia abajo, bottom si abre hacia arriba */
    anchor: number;
}

/** Contenedor donde se portalea el menú: el modal si existe (para no quedar fuera
 *  del focus-trap de Radix Dialog), o el body si no hay modal. */
function getPortalTarget(el: HTMLElement | null): HTMLElement {
    if (typeof document === "undefined") return null as unknown as HTMLElement;
    return (el?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
}

export function SearchableSelect({
    options,
    value,
    onValueChange,
    placeholder = "Seleccionar...",
    className,
    disabled = false
}: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Calcula la posición del menú (fixed) a partir del trigger. Se portalea dentro
    // del modal (o del body si no hay) para escapar de contenedores con
    // overflow-hidden (el listado de procesos) sin salir del focus-trap del Dialog.
    const computePosition = useCallback(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const target = getPortalTarget(containerRef.current);
        // Coordenadas del contenedor del portal: el body no tiene "rect" útil, se
        // usa el viewport. Si es el modal (con transform), position:fixed queda
        // relativo a su caja, así que restamos su origen.
        const isBody = !target || target === document.body;
        const parent = isBody ? null : target.getBoundingClientRect();
        const offLeft = parent ? parent.left : 0;
        const offTop = parent ? parent.top : 0;
        const bottomEdge = parent ? parent.bottom : window.innerHeight;

        const MENU_MAX = 300;
        const MARGIN = 4;
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;
        const openUp = spaceBelow < Math.min(MENU_MAX, 220) && spaceAbove > spaceBelow;
        const maxHeight = Math.max(160, Math.min(MENU_MAX, openUp ? spaceAbove : spaceBelow));
        setMenuPos({
            left: rect.left - offLeft,
            width: rect.width,
            openUp,
            maxHeight,
            anchor: openUp
                ? bottomEdge - rect.top + MARGIN   // bottom: apoya el menú justo arriba del trigger
                : rect.bottom - offTop + MARGIN,    // top: apoya el menú justo debajo del trigger
        });
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        computePosition();
        if (inputRef.current) inputRef.current.focus();

        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                containerRef.current && !containerRef.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };
        const handleReposition = () => computePosition();

        document.addEventListener("mousedown", handleClickOutside);
        window.addEventListener("resize", handleReposition);
        // capture: true para reaccionar al scroll de cualquier contenedor ancestro
        window.addEventListener("scroll", handleReposition, true);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            window.removeEventListener("resize", handleReposition);
            window.removeEventListener("scroll", handleReposition, true);
        };
    }, [isOpen, computePosition]);

    const filteredOptions = options.filter(opt =>
        opt.label.toLowerCase().includes(search.toLowerCase())
    );

    const selectedLabel = options.find(opt => opt.value === value)?.label || "";

    const handleSelect = (val: string) => {
        onValueChange(val);
        setIsOpen(false);
        setSearch("");
    };

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        onValueChange("");
    }

    return (
        <div className={cn("relative w-full", className)} ref={containerRef}>
            <div
                className={cn(
                    "flex items-center justify-between w-full h-9 px-3 py-2 border border-gray-200 rounded-md bg-white transition-colors text-sm",
                    disabled ? "bg-gray-100 cursor-not-allowed text-gray-400" : "cursor-pointer hover:border-blue-400",
                    isOpen && "border-blue-500 ring-2 ring-blue-500/20"
                )}
                onClick={() => !disabled && setIsOpen(!isOpen)}
            >
                <span className={cn("truncate mr-2", !selectedLabel && "text-gray-500")}>
                    {selectedLabel || placeholder}
                </span>
                <div className="flex items-center gap-1">
                    {selectedLabel && !disabled && (
                        <div role="button" onClick={handleClear} className="p-0.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors">
                            <X className="w-3 h-3" />
                        </div>
                    )}
                    <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", isOpen && "rotate-180")} />
                </div>
            </div>

            {isOpen && menuPos && typeof document !== "undefined" && createPortal(
                <div
                    ref={menuRef}
                    className="z-[9999] bg-white border border-gray-200 rounded-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in-0 zoom-in-95 duration-100 ring-1 ring-black/5"
                    style={{
                        position: "fixed",
                        pointerEvents: "auto",
                        left: menuPos.left,
                        width: menuPos.width,
                        maxHeight: menuPos.maxHeight,
                        ...(menuPos.openUp ? { bottom: menuPos.anchor } : { top: menuPos.anchor }),
                    }}
                    onKeyDown={(e) => {
                        // Que ESC cierre sólo el desplegable y no burbujee al Radix
                        // Dialog (si no, dispara el "Cancelar creación" del modal).
                        if (e.key === "Escape") {
                            e.stopPropagation();
                            e.nativeEvent.stopImmediatePropagation();
                            setIsOpen(false);
                        }
                    }}
                >
                    <div className="p-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50/80 backdrop-blur sticky top-0 z-10">
                        <Search className="w-4 h-4 text-gray-400" />
                        <input
                            ref={inputRef}
                            className="w-full text-base outline-none text-gray-700 placeholder:text-gray-400 bg-transparent"
                            placeholder="Buscar..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && filteredOptions.length > 0) {
                                    e.preventDefault();
                                    handleSelect(filteredOptions[0].value);
                                }
                            }}
                        />
                    </div>
                    <div className="overflow-y-auto flex-1 p-1">
                        {filteredOptions.length === 0 ? (
                            <div className="p-4 text-sm text-gray-400 text-center italic">No se encontraron resultados</div>
                        ) : (
                            filteredOptions.map((opt) => (
                                <div
                                    key={opt.value}
                                    className={cn(
                                        "px-3 py-2 text-sm rounded-md cursor-pointer flex items-center justify-between transition-colors mb-0.5",
                                        value === opt.value
                                            ? "bg-blue-50 text-blue-700 font-medium"
                                            : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                                    )}
                                    onClick={() => handleSelect(opt.value)}
                                >
                                    {opt.label}
                                    {value === opt.value && <Check className="w-4 h-4 text-blue-600" />}
                                </div>
                            ))
                        )}
                    </div>
                </div>,
                getPortalTarget(containerRef.current)
            )}
        </div>
    );
}
