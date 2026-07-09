import { useState, type FormEvent } from "react";
import { api } from "../api";

interface CreateMarketProps {
  onCreated: () => void;
}

export function CreateMarket({ onCreated }: CreateMarketProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resolutionDescription, setResolutionDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const market = await api.createMarket(title, description, resolutionDescription);
      setSuccess(`Market "${market.title}" created successfully!`);
      setTitle("");
      setDescription("");
      setResolutionDescription("");
      onCreated();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Failed to create market");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-market-section">
      <span className="eyebrow">New market</span>
      <h3>Create a Prediction Market</h3>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="Will X happen by Y date?"
          />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            placeholder="Describe the market and its context..."
          />
        </div>

        <div className="form-group">
          <label>Resolution criteria</label>
          <textarea
            value={resolutionDescription}
            onChange={(e) => setResolutionDescription(e.target.value)}
            required
            placeholder="How will this market be resolved? What counts as Yes vs No?"
          />
        </div>

        <button className="primary-action" type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Market"}
        </button>
      </form>
    </div>
  );
}
