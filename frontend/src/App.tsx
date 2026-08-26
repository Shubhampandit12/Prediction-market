import { useState, useEffect, type FormEvent } from "react";
import { useUser } from "./hooks/useUser";
import { api } from "./api";
import type { Market } from "./types";
import { MarketList } from "./components/MarketList";
import { MarketDetail } from "./components/MarketDetail";
import { OrderForm } from "./components/OrderForm";
import { Balance } from "./components/Balance";
import { Positions } from "./components/Positions";
import { OrderHistory } from "./components/OrderHistory";
import { SplitMerge } from "./components/SplitMerge";
import { CreateMarket } from "./components/CreateMarket";
import { ResolveMarket } from "./components/ResolveMarket";
import "./App.css";

function AuthForm({ onAuth }: { onAuth: (token: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = mode === "login"
        ? await api.login(email, password)
        : await api.register(email, password);
      onAuth(data.token);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>Prediction Market</h1>
        <p>Sign in to trade prediction markets</p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter password"
              minLength={6}
            />
          </div>
          <button className="signin-button" type="submit" disabled={loading}>
            {loading ? "Processing..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}

function App() {
  const { user, login, logout } = useUser();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [activeTab, setActiveTab] = useState<string>("markets");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchMarkets();
  }, []);

  const fetchMarkets = async () => {
    try {
      const nextMarkets = await api.getMarkets();
      setMarkets(nextMarkets);
      setSelectedMarket((current) =>
        current ? nextMarkets.find((market) => market.id === current.id) || current : current
      );
    } catch (err) {
      console.error("Failed to fetch markets:", err);
    }
  };

  const handleSignOut = () => {
    api.logout();
    logout();
    setSelectedMarket(null);
    setActiveTab("markets");
  };

  const handleSelectMarket = (marketId: string) => {
    const market = markets.find((m) => m.id === marketId);
    if (market) {
      setSelectedMarket(market);
      setActiveTab("trading");
    }
  };

  const handleActionComplete = () => {
    setRefreshKey((prev) => prev + 1);
    fetchMarkets();
  };

  if (!user) {
    return <AuthForm onAuth={login} />;
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Prediction Market</h1>
        <div className="user-info">
          <span>{user.email}</span>
          <button onClick={handleSignOut} className="logout-button">
            Logout
          </button>
        </div>
      </header>

      <nav className="app-nav">
        <button
          className={activeTab === "markets" ? "active" : ""}
          onClick={() => {
            setActiveTab("markets");
            setSelectedMarket(null);
          }}
        >
          Markets
        </button>
        <button
          className={activeTab === "trading" ? "active" : ""}
          onClick={() => setActiveTab("trading")}
          disabled={!selectedMarket}
        >
          Trading
        </button>
        <button
          className={activeTab === "balance" ? "active" : ""}
          onClick={() => setActiveTab("balance")}
        >
          Balance
        </button>
        <button
          className={activeTab === "positions" ? "active" : ""}
          onClick={() => setActiveTab("positions")}
        >
          Positions
        </button>
        <button
          className={activeTab === "history" ? "active" : ""}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
        <button
          className={activeTab === "create" ? "active" : ""}
          onClick={() => setActiveTab("create")}
        >
          Create
        </button>
      </nav>

      <main className="app-main">
        {activeTab === "markets" && (
          <MarketList markets={markets} onSelectMarket={handleSelectMarket} />
        )}

        {activeTab === "trading" && selectedMarket && (
          <div className="trading-container">
            <div>
              <MarketDetail
                market={selectedMarket}
                onBack={() => {
                  setActiveTab("markets");
                  setSelectedMarket(null);
                }}
              />
              {!selectedMarket.resolution && (
                <ResolveMarket
                  market={selectedMarket}
                  onResolved={handleActionComplete}
                />
              )}
              {selectedMarket.resolution && (
                <div className={`resolved-badge ${selectedMarket.resolution.toLowerCase()}`}>
                  Resolved: {selectedMarket.resolution}
                </div>
              )}
            </div>
            <aside className="trade-sidebar">
              <OrderForm
                market={selectedMarket}
                onOrderPlaced={handleActionComplete}
              />
              <SplitMerge
                market={selectedMarket}
                onActionComplete={handleActionComplete}
              />
            </aside>
          </div>
        )}

        {activeTab === "balance" && <Balance key={refreshKey} />}

        {activeTab === "positions" && (
          <Positions markets={markets} key={refreshKey} />
        )}

        {activeTab === "history" && (
          <OrderHistory markets={markets} key={refreshKey} />
        )}

        {activeTab === "create" && (
          <CreateMarket onCreated={handleActionComplete} />
        )}
      </main>
    </div>
  );
}

export default App;
