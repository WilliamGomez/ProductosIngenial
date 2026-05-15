import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";

/**
 * SidebarContext — comparte el estado "collapsed" entre Sidebar y MainLayout.
 *
 * Persistencia: localStorage para que la preferencia del usuario sobreviva
 * a refreshes. Key específica para no chocar con `session_token` /
 * `device_id` que ya guarda SessionContext.
 *
 * Por qué un context (y no Zustand/Recoil): el estado es ÚNICO (booleano)
 * y vive entre dos componentes hermanos. Un context con dos hooks hijos
 * es más simple y zero-deps. Si más adelante crece (modo móvil con
 * drawer, multi-sidebar, etc.), considerar promover a una librería real.
 */

const STORAGE_KEY = "votometro_ui_sidebar_collapsed";

interface SidebarContextValue {
    collapsed: boolean;
    toggle: () => void;
    setCollapsed: (value: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(
    undefined
);

const readStoredValue = (): boolean => {
    if (typeof window === "undefined") return false;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw === "true";
    } catch {
        // localStorage puede estar bloqueado (modo incógnito iOS, política
        // estricta de cookies). Default a expandido.
        return false;
    }
};

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
    const [collapsed, setCollapsedState] = useState<boolean>(readStoredValue);

    const setCollapsed = useCallback((value: boolean) => {
        setCollapsedState(value);
        try {
            window.localStorage.setItem(STORAGE_KEY, String(value));
        } catch {
            // ignorable — la UI sigue funcionando, sólo no persiste.
        }
    }, []);

    const toggle = useCallback(() => {
        setCollapsed(!collapsed);
    }, [collapsed, setCollapsed]);

    // En pantallas pequeñas (<768px) auto-colapsamos el sidebar al cargar
    // para que no tape el contenido. El usuario puede expandir manualmente.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(max-width: 767px)");
        if (mq.matches) {
            setCollapsedState(true);
        }
    }, []);

    return (
        <SidebarContext.Provider value={{ collapsed, toggle, setCollapsed }}>
            {children}
        </SidebarContext.Provider>
    );
};

export const useSidebar = (): SidebarContextValue => {
    const ctx = useContext(SidebarContext);
    if (!ctx) {
        throw new Error("useSidebar must be used within a SidebarProvider");
    }
    return ctx;
};
