import { useState, useEffect } from "react";
import { api } from "../api";
import type { Market, OrderHistory as OrderHistoryType } from "../types";

interface OrderHistoryProps {
  markets: Market[];
}

export function OrderHistory({ markets }: OrderHistoryProps) {
  const [history, setHistory] = useState<OrderHistoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const marketTitleById = new Map(markets.map((market) => [market.id, market.title]));

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const data = await api.getOrderHistory();
      setHistory(data);
    } catch (err) {
      console.error("Failed to fetch order history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const formatPrice = (price: number) => {
    if (price === 0) return "-";
    return `$${(price / 100).toFixed(2)}`;
  };

  const getOrderTypeClass = (orderType: string) => {
    switch (orderType.toLowerCase()) {
      case "buy":
        return "buy";
      case "sell":
        return "sell";
      case "split":
        return "split";
      case "merge":
        return "merge";
      default:
        return "";
    }
  };

  if (loading) {
    return <div className="history-section">Loading order history...</div>;
  }

  return (
    <div className="history-section">
      <h3>Order History</h3>
      {history.length === 0 ? (
        <p>No order history yet</p>
      ) : (
        <table className="history-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Market</th>
              <th>Price</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {history.map((order) => (
              <tr key={order.id}>
                <td className={getOrderTypeClass(order.orderType)}>{order.orderType}</td>
                <td className="market-cell">
                  <span className="market-title">{marketTitleById.get(order.marketId) || "Unknown market"}</span>
                  <span className="market-id">{order.marketId}</span>
                </td>
                <td>{formatPrice(order.price)}</td>
                <td>{order.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={fetchHistory} className="refresh-button">
        Refresh
      </button>
    </div>
  );
}
