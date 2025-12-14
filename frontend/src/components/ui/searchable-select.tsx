"use client";

import React, { useState, useRef, useEffect } from "react";
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
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
        if (isOpen && containerRef.current) {
            // Pequeño delay para asegurar que el dropdown se renderizó y el layout se ajustó
            setTimeout(() => {
                containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 100);
        }
    }, [isOpen]);

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

            {isOpen && (
                <div
                    className="absolute z-[9999] w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-2xl max-h-[300px] overflow-hidden flex flex-col animate-in fade-in-0 zoom-in-95 duration-100 ring-1 ring-black/5"
                    style={{ position: 'absolute', top: '100%', left: 0, right: 0 }}
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
                </div>
            )}
        </div>
    );
}
