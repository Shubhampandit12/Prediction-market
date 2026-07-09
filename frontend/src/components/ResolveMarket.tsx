import { useState } from "react";
import { api } from "../api";
import type { Market } from "../types";

interface ResolveMarketProps {
  market: Market;
  onResolved: () => void;
}

export function ResolveMarket({ market, onResolved }: ResolveMarketProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedResolution, setSelectedResolution] = useState<"Yes" | "No" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleResolveClick = (resolution: "Yes" | "No") => {
    setSelectedResolution(resolution);
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    if (!selectedResolution) return;

    setLoading(true);
    setError("");

    try {
      await api.resolveMarket(market.id, selectedResolution);
      setShowConfirm(false);
      onResolved();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Failed to resolve market");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setShowConfirm(false);
    setSelectedResolution(null);
  };

  return (
    <>
      <div className="resolve-section">
        <h4>Resolve Market</h4>
        {error && <div className="error">{error}</div>}
        <div className="resolve-actions">
          <button
            className="resolve-yes"
            onClick={() => handleResolveClick("Yes")}
            disabled={loading}
          >
            Resolve YES
          </button>
          <button
            className="resolve-no"
            onClick={() => handleResolveClick("No")}
            disabled={loading}
          >
            Resolve NO
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="confirm-overlay" onClick={handleCancel}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>Confirm Resolution</h4>
            <p>
              Are you sure you want to resolve "{market.title}" as <strong>{selectedResolution}</strong>?
              This action cannot be undone. All winning positions will be paid out.
            </p>
            <div className="confirm-dialog-actions">
              <button className="cancel-btn" onClick={handleCancel} disabled={loading}>
                Cancel
              </button>
              <button className="confirm-btn" onClick={handleConfirm} disabled={loading}>
                {loading ? "Resolving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
