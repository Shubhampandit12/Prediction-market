import { useState, useEffect } from "react";
import { api } from "../api";

export function Balance() {
  const [balance, setBalance] = useState<number>(0);
  const [amount, setAmount] = useState<string>("100");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");

  const fetchBalance = async () => {
    try {
      const data = await api.getBalance();
      setBalance((data.usdBalance ?? 0) / 100);
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  const handleOnramp = async () => {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      await api.onramp(parseFloat(amount));
      setSuccess(`Successfully added $${amount} to your balance!`);
      fetchBalance();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Onramp failed");
    } finally {
      setLoading(false);
    }
  };

  const handleOfframp = async () => {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      await api.offramp(parseFloat(amount));
      setSuccess(`Successfully withdrew $${amount} from your balance!`);
      fetchBalance();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Offramp failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="balance-section">
      <h3>Balance</h3>
      <div className="balance-display">
        <span className="balance-amount">${balance.toFixed(2)}</span>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="balance-actions">
        <div className="form-group">
          <label>Amount ($):</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <button onClick={handleOnramp} disabled={loading}>
          {loading ? "Processing..." : "Onramp"}
        </button>
        <button onClick={handleOfframp} disabled={loading}>
          {loading ? "Processing..." : "Offramp"}
        </button>
      </div>
    </div>
  );
}
