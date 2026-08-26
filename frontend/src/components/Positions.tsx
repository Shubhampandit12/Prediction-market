import { useState, useEffect } from "react";
import { api } from "../api";
import type { Market, Position } from "../types";

interface PositionsProps {
  markets: Market[];
}

export function Positions({ markets }: PositionsProps) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const marketTitleById = new Map(markets.map((market) => [market.id, market.title]));

  const fetchPositions = async () => {
    setLoading(true);
    try {
      const data = await api.getPositions();
      setPositions(data);
    } catch (err) {
      console.error("Failed to fetch positions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
  }, []);

  if (loading) {
    return <div className="positions-section">Loading positions...</div>;
  }

  return (
    <div className="positions-section">
      <h3>Your Positions</h3>
      {positions.length === 0 ? (
        <p>No positions yet</p>
      ) : (
        <table className="positions-table">
          <thead>
            <tr>
              <th>Market</th>
              <th>Type</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.id}>
                <td className="market-cell">
                  <span className="market-title">{marketTitleById.get(position.marketId) || "Unknown market"}</span>
                  <span className="market-id">{position.marketId}</span>
                </td>
                <td className={position.type.toLowerCase()}>{position.type}</td>
                <td>{position.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={fetchPositions} className="refresh-button">
        Refresh
      </button>
    </div>
  );
}
