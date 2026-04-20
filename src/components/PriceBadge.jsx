import React, { useState } from 'react';
import { Tag, TrendingDown, ExternalLink } from 'lucide-react';

/**
 * PriceBadge — shows a compact price card for detected games.
 * Expands on click to show full deal breakdown.
 */
export default function PriceBadge({ priceData }) {
  const [expanded, setExpanded] = useState(false);

  if (!priceData || priceData.length === 0) return null;

  const topGame = priceData[0];
  const isHistoricLow = topGame.cheapestEver &&
    parseFloat(topGame.cheapest) <= parseFloat(topGame.cheapestEver.price);

  return (
    <div className={`price-badge-wrapper animate-fade-in ${expanded ? 'expanded' : ''}`}>
      {/* Compact pill — always visible */}
      <button
        className={`price-pill glass-panel ${isHistoricLow ? 'price-pill--low' : ''}`}
        onClick={() => setExpanded(!expanded)}
        title="Click to see full deal breakdown"
      >
        {isHistoricLow
          ? <TrendingDown size={13} className="price-pill-icon" />
          : <Tag size={13} className="price-pill-icon" />
        }
        <span className="price-pill-label">
          {isHistoricLow ? '🔥 Historic Low! ' : ''}
          <strong>${topGame.cheapest}</strong>
          <span className="price-pill-name"> · {topGame.title}</span>
        </span>
        <span className="price-pill-toggle">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded deal table */}
      {expanded && (
        <div className="price-panel glass-panel animate-fade-in">
          {priceData.map((game) => {
            const atLow = game.cheapestEver &&
              parseFloat(game.cheapest) <= parseFloat(game.cheapestEver.price);
            return (
              <div key={game.title} className="price-game-block">
                <div className="price-game-header">
                  {game.thumb && (
                    <img src={game.thumb} alt={game.title} className="price-thumb" />
                  )}
                  <div>
                    <div className="price-game-title">{game.title}</div>
                    {game.cheapestEver && (
                      <div className={`price-historic ${atLow ? 'price-historic--low' : ''}`}>
                        {atLow
                          ? '🔥 AT HISTORIC LOW!'
                          : `Historic low: $${game.cheapestEver.price}`}
                      </div>
                    )}
                  </div>
                </div>

                {game.deals.length > 0 && (
                  <table className="price-table">
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>Price</th>
                        <th>Discount</th>
                        <th>Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {game.deals.map((deal, i) => (
                        <tr key={i} className={i === 0 ? 'price-row--best' : ''}>
                          <td>{deal.store}</td>
                          <td><strong>${deal.price}</strong></td>
                          <td>
                            {deal.savings > 0
                              ? <span className="price-saving">−{deal.savings}%</span>
                              : <span className="price-full">Full Price</span>}
                          </td>
                          <td className="price-verdict">
                            {i === 0 && atLow ? '🔥 Buy Now' :
                             i === 0 && deal.savings >= 50 ? '✅ Great Deal' :
                             i === 0 && deal.savings >= 25 ? '👍 Decent' :
                             deal.savings === 0 ? '⏳ Wait' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
          <div className="price-footer">
            <span>Powered by </span>
            <a
              href="https://www.cheapshark.com"
              target="_blank"
              rel="noopener noreferrer"
              className="price-source-link"
            >
              CheapShark <ExternalLink size={10} />
            </a>
            <span> · Updates every 15 min</span>
          </div>
        </div>
      )}
    </div>
  );
}
