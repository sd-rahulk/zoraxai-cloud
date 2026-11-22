import { useEffect, useState } from "react";
import { api, message } from "./api";

export function useResource<T>(path: string | null, nonce = 0) {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: string }>({ path: null });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ path, data }); })
      .catch(error => { if (!controller.signal.aborted) setState({ path, error: message(error) }); });
    return () => controller.abort();
  }, [path, nonce]);
  const current = state.path === path ? state : undefined;
  return { data: current?.data, error: current?.error, loading: Boolean(path && !current) };
}
