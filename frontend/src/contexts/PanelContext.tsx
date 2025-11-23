"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface PanelContextType {
    isDetailsPanelOpen: boolean;
    setIsDetailsPanelOpen: (open: boolean) => void;
}

const PanelContext = createContext<PanelContextType | undefined>(undefined);

export function PanelProvider({ children }: { children: ReactNode }) {
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

    return (
        <PanelContext.Provider value={{ isDetailsPanelOpen, setIsDetailsPanelOpen }}>
            {children}
        </PanelContext.Provider>
    );
}

export function usePanelContext() {
    const context = useContext(PanelContext);
    if (context === undefined) {
        throw new Error("usePanelContext must be used within a PanelProvider");
    }
    return context;
}
