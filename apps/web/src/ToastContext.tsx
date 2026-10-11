import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  onDismiss?: () => void;
}

interface ToastContextValue {
  showToast: (message: string, type?: "success" | "error" | "info", onDismiss?: () => void) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success", onDismiss?: () => void) => {
    const id = nextId++;
    setToasts(current => [...current, { id, message, type, onDismiss }]);
    window.setTimeout(() => {
      setToasts(current => {
        const toast = current.find(t => t.id === id);
        if (toast?.onDismiss) {
          toast.onDismiss();
        }
        return current.filter(t => t.id !== id);
      });
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{ position: "fixed", bottom: 20, left: 20, zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            role="status"
            style={{
              padding: "10px 14px",
              background: "var(--surface)",
              border: `1px solid ${toast.type === "error" ? "#B42318" : "var(--border-strong)"}`,
              borderLeft: `3px solid ${toast.type === "error" ? "#B42318" : toast.type === "info" ? "var(--human)" : "var(--human)"}`,
              borderRadius: 3,
              fontSize: 13,
              color: "var(--text)",
              animation: "pxr-toast-slide-in 0.2s ease-out",
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("ToastProvider is missing");
  return context;
}
