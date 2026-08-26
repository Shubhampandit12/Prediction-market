import axios from "axios";
import type { Market, Position, OrderHistory } from "./types";

// In the Docker single-image deploy, the backend serves this frontend from
// its own origin, so API calls should be relative (same-origin, no CORS).
// In local dev the frontend runs on Vite's dev server (5173) separately from
// the backend (3000), so it needs an absolute URL. VITE_API_URL overrides
// either default, e.g. for a build that points at a separately-hosted API.
const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

function getToken(): string | null {
  return localStorage.getItem("token");
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const api = {
  // ─── Auth ───────────────────────────────────────────────────────────────────

  register: async (email: string, password: string) => {
    const response = await axios.post(`${API_BASE}/auth/register`, { email, password });
    const { token } = response.data;
    localStorage.setItem("token", token);
    return response.data;
  },

  login: async (email: string, password: string) => {
    const response = await axios.post(`${API_BASE}/auth/login`, { email, password });
    const { token } = response.data;
    localStorage.setItem("token", token);
    return response.data;
  },

  logout: () => {
    localStorage.removeItem("token");
  },

  // ─── Public ─────────────────────────────────────────────────────────────────

  getMarkets: async (): Promise<Market[]> => {
    const response = await axios.get(`${API_BASE}/markets`);
    return response.data.markets ?? [];
  },

  getMarket: async (marketId: string): Promise<Market> => {
    const response = await axios.get(`${API_BASE}/market`, {
      params: { marketId },
    });
    return response.data.market;
  },

  // ─── Protected (require auth) ──────────────────────────────────────────────

  placeOrder: async (orderData: {
    marketId: string;
    side: "yes" | "no";
    type: "buy" | "sell";
    price: number;
    qty: number;
  }) => {
    const response = await axios.post(`${API_BASE}/order`, orderData, {
      headers: authHeaders(),
    });
    return response.data;
  },

  getBalance: async (): Promise<{ usdBalance: number }> => {
    const response = await axios.get(`${API_BASE}/balance`, {
      headers: authHeaders(),
    });
    return response.data;
  },

  getPositions: async (): Promise<Position[]> => {
    const response = await axios.get(`${API_BASE}/positions`, {
      headers: authHeaders(),
    });
    return response.data.positions ?? [];
  },

  getOrderHistory: async (): Promise<OrderHistory[]> => {
    const response = await axios.post(`${API_BASE}/history`, {}, {
      headers: authHeaders(),
    });
    return response.data.history ?? [];
  },

  splitPosition: async (data: { marketId: string; amount: number }) => {
    const response = await axios.post(`${API_BASE}/split`, data, {
      headers: authHeaders(),
    });
    return response.data;
  },

  mergePosition: async (data: { marketId: string; amount: number }) => {
    const response = await axios.post(`${API_BASE}/merge`, data, {
      headers: authHeaders(),
    });
    return response.data;
  },

  onramp: async (amount: number) => {
    const response = await axios.post(`${API_BASE}/onramp`, { amount }, {
      headers: authHeaders(),
    });
    return response.data;
  },

  offramp: async (amount: number) => {
    const response = await axios.post(`${API_BASE}/offramp`, { amount }, {
      headers: authHeaders(),
    });
    return response.data;
  },

  // ─── New: Market Management ─────────────────────────────────────────────────

  createMarket: async (title: string, description: string, resolutionDescription: string): Promise<Market> => {
    const response = await axios.post(`${API_BASE}/markets`, { title, description, resolutionDescription }, {
      headers: authHeaders(),
    });
    return response.data;
  },

  resolveMarket: async (marketId: string, resolution: "Yes" | "No") => {
    const response = await axios.post(`${API_BASE}/markets/${marketId}/resolve`, { resolution }, {
      headers: authHeaders(),
    });
    return response.data;
  },
};
