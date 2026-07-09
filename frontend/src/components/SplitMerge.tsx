import { useState } from "react";
import { api } from "../api";
import type { Market } from "../types";

interface SplitMergeProps {
  market: Market;
  onActionComplete: () => void;
}

export function SplitMerge({ market, onActionComplete }: SplitMergeProps) {
  const [amount, setAmount] = useState<string>("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");

  const runAction = async (action: "split" | "merge") => {
    const parsedAmount = Math.floor(Number(amount));
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1) {
      setError("Enter a valid quantity.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      if (action === "split") {
        await api.splitPosition({ marketId: market.id, amount: parsedAmount });
      } else {
        await api.mergePosition({ marketId: market.id, amount: parsedAmount });
      }

      setSuccess(action === "split" ? "Split completed." : "Merge completed.");
      onActionComplete();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || `${action} failed`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="trade-card split-merge-section">
      <div className="trade-card-header">
        <div>
          <span>Market actions</span>
          <h3>Split / Merge</h3>
        </div>
        <span>{market.title}</span>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="form-group">
        <label>Quantity</label>
        <input
          type="number"
          min="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className="split-merge-actions">
        <button type="button" onClick={() => runAction("split")} disabled={loading}>
          Split
        </button>
        <button type="button" onClick={() => runAction("merge")} disabled={loading}>
          Merge
        </button>
      </div>
    </section>
  );
}
