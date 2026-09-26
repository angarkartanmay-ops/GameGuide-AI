import React, { useId, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';

const verdictFor = (i, deal, atLow) =>
  i === 0 && atLow ? 'Buy now'
    : i === 0 && deal.savings >= 50 ? 'Great deal'
      : i === 0 && deal.savings >= 25 ? 'Decent'
        : deal.savings === 0 ? 'Wait' : '—';

/**
 * Live price card from /price, docked above the command bar. Collapsed it is
 * one line — best price, store, discount — and expands to every store.
 */
export default function PriceBadge({ priceData }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  if (!priceData || priceData.length === 0) return null;

  const top = priceData[0];
  const best = top.deals?.[0];
  const atLow = !!top.cheapestEver && parseFloat(top.cheapest) <= parseFloat(top.cheapestEver.price);

  return (
    <section className={`cx-deal${expanded ? ' is-open' : ''}`} aria-label="Live prices">
      <div className="cx-deal__row">
        {top.thumb && <img className="cx-deal__thumb" src={top.thumb} alt="" />}
        <div className="cx-deal__main">
          <span className="cx-deal__title">{top.title} · best deal</span>
          <span className="cx-deal__price">
            <strong>${top.cheapest}</strong>
            {best?.store && <span className="cx-deal__store">{best.store}</span>}
            {best?.savings > 0 && <span className="cx-deal__off">−{best.savings}%</span>}
            {atLow && <span className="cx-deal__low">All-time low</span>}
          </span>
        </div>
        <button
          type="button"
          className="cx-deal__toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((v) => !v)}
        >
          Deals <ChevronDown size={13} aria-hidden="true" className={expanded ? 'is-flipped' : undefined} />
        </button>
      </div>

      {expanded && (
        <div className="cx-deal__panel" id={panelId}>
          {priceData.map((game) => {
            const low = !!game.cheapestEver && parseFloat(game.cheapest) <= parseFloat(game.cheapestEver.price);
            return (
              <div key={game.title} className="cx-deal__game">
                <div className="cx-deal__game-head">
                  <span>{game.title}</span>
                  {game.cheapestEver && (
                    <span className={low ? 'cx-deal__low' : 'cx-deal__hist'}>
                      {low ? 'At its all-time low' : `All-time low $${game.cheapestEver.price}`}
                    </span>
                  )}
                </div>
                {game.deals.length > 0 && (
                  <table className="cx-deal__table">
                    <thead>
                      <tr><th scope="col">Store</th><th scope="col">Price</th><th scope="col">Discount</th><th scope="col">Verdict</th></tr>
                    </thead>
                    <tbody>
                      {game.deals.map((deal, i) => (
                        <tr key={i} className={i === 0 ? 'is-best' : undefined}>
                          <td>{deal.url
                            ? <a href={deal.url} target="_blank" rel="noopener noreferrer">{deal.store}</a>
                            : deal.store}</td>
                          <td className="cx-num">${deal.price}</td>
                          <td className="cx-num">{deal.savings > 0 ? `−${deal.savings}%` : 'Full price'}</td>
                          <td>{verdictFor(i, deal, low)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
          <div className="cx-deal__foot">
            Prices from <a href="https://www.cheapshark.com" target="_blank" rel="noopener noreferrer">CheapShark <ExternalLink size={10} aria-hidden="true" /></a> · refreshed every 15 min
          </div>
        </div>
      )}
    </section>
  );
}
