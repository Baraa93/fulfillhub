import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface CatalogProduct {
  id: string;
  sku: string;
  title: string;
  category: string;
  status: string;
  suggestedPriceUsd: string;
  supplierCost: string;
  costCurrency: string;
  stockType: string;
  stockQuantity: number;
  overallScore: string;
  _count?: { sellerProducts: number };
}

export default function CatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ products: CatalogProduct[] }>("/catalog")
      .then((data) => setProducts(data.products))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Catalog</h1>
        <p>Manage curated product catalog</p>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading catalog...</p>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <h3>No products in catalog</h3>
            <p>Add products by approving seller requests or creating them manually.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Title</th>
                <th>Category</th>
                <th>Price (USD)</th>
                <th>Cost</th>
                <th>Stock</th>
                <th>Score</th>
                <th>Status</th>
                <th>Sellers</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.sku}</code></td>
                  <td>{p.title}</td>
                  <td>{p.category || "—"}</td>
                  <td>${Number(p.suggestedPriceUsd).toFixed(2)}</td>
                  <td>{Number(p.supplierCost).toFixed(2)} {p.costCurrency}</td>
                  <td>
                    <span className={`badge ${p.stockType === "IN_WAREHOUSE" ? "badge-success" : "badge-info"}`}>
                      {p.stockType === "IN_WAREHOUSE" ? `${p.stockQuantity} in stock` : "On Demand"}
                    </span>
                  </td>
                  <td>{p.overallScore ? Number(p.overallScore).toFixed(1) : "—"}</td>
                  <td>
                    <span className={`badge ${p.status === "ACTIVE" ? "badge-success" : "badge-default"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td>{p._count?.sellerProducts ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
