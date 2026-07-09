import { useState, useEffect } from "react";

interface UserState {
  userId: string;
  email: string;
  token: string;
}

function decodeJwtPayload(token: string): { sub?: string; email?: string; exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

function isTokenExpired(payload: { exp?: number }): boolean {
  if (!payload.exp) return false;
  return Date.now() >= payload.exp * 1000;
}

export function useUser() {
  const [user, setUser] = useState<UserState | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      return;
    }

    const payload = decodeJwtPayload(token);
    if (!payload || isTokenExpired(payload)) {
      localStorage.removeItem("token");
      setUser(null);
      return;
    }

    setUser({
      userId: payload.sub || "",
      email: payload.email || "",
      token,
    });
  }, []);

  const login = (token: string) => {
    localStorage.setItem("token", token);
    const payload = decodeJwtPayload(token);
    if (payload) {
      setUser({
        userId: payload.sub || "",
        email: payload.email || "",
        token,
      });
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  return { user, login, logout };
}
