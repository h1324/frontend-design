import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const Ctx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flash = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), 2200);
  }, []);
  return (
    <Ctx.Provider value={flash}>
      {children}
      {msg && <div className="toast no-print">{msg}</div>}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
