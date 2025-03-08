import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest<T = any>(
  url: string,
  options?: RequestInit
): Promise<T>;
export async function apiRequest<T = any>(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<T>;
export async function apiRequest<T = any>(
  methodOrUrl: string,
  urlOrOptions?: string | RequestInit,
  data?: unknown | undefined,
): Promise<T> {
  let method: string;
  let url: string;
  let options: RequestInit = {};
  
  // Handle overload cases
  if (typeof urlOrOptions === 'string') {
    // First overload: method, url, data
    method = methodOrUrl;
    url = urlOrOptions;
    options = {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    };
  } else {
    // Second overload: url, options
    url = methodOrUrl;
    options = {
      method: 'GET',
      ...urlOrOptions,
      credentials: "include",
    };
  }

  const res = await fetch(url, options);
  await throwIfResNotOk(res);
  return res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
