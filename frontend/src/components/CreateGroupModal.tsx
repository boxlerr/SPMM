"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderPlus, Check } from "lucide-react";

interface CreateGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreateGroup: (name: string, color: string) => void;
}

const PRESET_COLORS = [
    { name: "Azul", value: "#3b82f6" },
    { name: "Verde", value: "#10b981" },
    { name: "Naranja", value: "#f59e0b" },
    { name: "Rojo", value: "#ef4444" },
    { name: "Púrpura", value: "#8b5cf6" },
    { name: "Rosa", value: "#ec4899" },
    { name: "Turquesa", value: "#06b6d4" },
    { name: "Lima", value: "#84cc16" },
    { name: "Índigo", value: "#6366f1" },
    { name: "Amarillo", value: "#eab308" },
];

export default function CreateGroupModal({ isOpen, onClose, onCreateGroup }: CreateGroupModalProps) {
    const [groupName, setGroupName] = useState("");
    const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0].value);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (groupName.trim()) {
            onCreateGroup(groupName.trim(), selectedColor);
            setGroupName("");
            setSelectedColor(PRESET_COLORS[0].value);
            onClose();
        }
    };

    const handleClose = () => {
        setGroupName("");
        setSelectedColor(PRESET_COLORS[0].value);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[500px] bg-white rounded-xl shadow-2xl border-0">
                <DialogHeader className="border-b pb-4">
                    <DialogTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <div className="p-2 bg-blue-50 rounded-lg">
                            <FolderPlus className="h-6 w-6 text-blue-600" />
                        </div>
                        Crear Nuevo Grupo
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 py-6">
                    {/* Group Name */}
                    <div className="space-y-2">
                        <Label htmlFor="groupName" className="text-sm font-semibold text-gray-700">
                            Nombre del Grupo
                        </Label>
                        <Input
                            id="groupName"
                            placeholder="Ej: Iniciado, En Revisión, Urgente..."
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            className="h-11 border-gray-300 focus:border-blue-500 focus:ring-blue-500 text-base"
                            required
                            autoFocus
                        />
                    </div>

                    {/* Color Picker */}
                    <div className="space-y-3">
                        <Label className="text-sm font-semibold text-gray-700">
                            Color del Grupo
                        </Label>
                        <div className="grid grid-cols-5 gap-3">
                            {PRESET_COLORS.map((color) => (
                                <button
                                    key={color.value}
                                    type="button"
                                    onClick={() => setSelectedColor(color.value)}
                                    className="group relative"
                                    title={color.name}
                                >
                                    <div
                                        className={`w-full aspect-square rounded-lg transition-all duration-200 hover:scale-110 hover:shadow-lg ${selectedColor === color.value
                                            ? 'ring-4 ring-offset-2 shadow-lg scale-105'
                                            : 'hover:ring-2 hover:ring-offset-1'
                                            }`}
                                        style={{
                                            backgroundColor: color.value
                                        }}
                                    >
                                        {selectedColor === color.value && (
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <Check className="h-5 w-5 text-white drop-shadow-lg" strokeWidth={3} />
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1.5 text-center font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                        {color.name}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Preview */}
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold text-gray-700">
                            Vista Previa
                        </Label>
                        <div
                            className="flex items-center gap-3 px-4 py-3 border-l-4 rounded-l-md bg-gray-50"
                            style={{ borderLeftColor: selectedColor }}
                        >
                            <h3 className="font-bold text-base" style={{ color: selectedColor }}>
                                {groupName || "Nombre del Grupo"}
                            </h3>
                            <span className="text-gray-400 text-sm">
                                0 Tareas
                            </span>
                        </div>
                    </div>

                    <DialogFooter className="mt-8 pt-4 border-t gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClose}
                            className="h-10 px-6 hover:bg-gray-50"
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={!groupName.trim()}
                            className="h-10 px-6 bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Crear Grupo
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
