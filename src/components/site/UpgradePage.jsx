import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Lock, ShieldCheck } from 'lucide-react';
import { LINKS, mailto } from '../../site/links';
import { HERO_GAMES, heroArt } from '../../site/showcase';
import {
  PLANS, money, yearlySaving, readUpgradeToken, billingOpen, fetchPlans, startCheckout, signIn, CHECKOUT_ERRORS,
} from '../../site/pricing';
import { gsap, useCalm, useScene } from '../../site/motion';
import SiteNav from './SiteNav';
import SiteFooter from './SiteFooter';
import { Overline } from './bits';
import '../../styles/site.css';

const PRO = PLANS.find(p => p.id === 'pro');
const SERVER = PLANS.find(p => p.id === 'server');
const FREE = PLANS.find(p => p.id === 'free');

// Buyers in India see rupees and UPI first, everyone else cards in dollars.
const inIndia = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Kolkata'; } catch { return false; }
};
const sells = (rail, plan, iv) => !!rail?.offers?.some(o => o.plan === plan && o.interval === iv);

/** Two-way switch drawn as one control (Monthly | Yearly, Card | UPI). */
function Segmented({ label, value, options, onChange }) {
  return (
    <div className="s-seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`s-seg__opt${value === o.value ? ' is-on' : ''}`}
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
        >
          {o.label}{o.note && <span className="s-seg__note">{o.note}</span>}
        </button>
      ))}
    </div>
  );
}

function Features({ items }) {
  return (
    <ul className="s-plan__features">
      {items.map(f => <li key={f}><Check size={15} aria-hidden="true" />{f}</li>)}
    </ul>
  );
}

/**
 * The plans page. Reached from /upgrade in Discord with a signed link that
 * already knows who is buying; the bot creates the checkout and the payment
 * provider takes it from there. Without a link it is a price list that says
 * how to get one.
 */
export default function UpgradePage({ token: linkToken, thanks, onBack, onLogo, onNavigate }) {
  const calm = useCalm();
  const rootRef = useRef(null);
  const [game] = useState(() => HERO_GAMES[2] || HERO_GAMES[0]);
  const [period, setPeriod] = useState('year');
  const [rail, setRail] = useState(inIndia() ? 'upi' : 'card');
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // The clock the page reads; ticking it keeps "valid for N minutes" honest.
  const [now, setNow] = useState(() => Date.now());
  // Email sign-in, for test and review accounts that have no Discord to run
  // /upgrade from (payment providers review the checkout this way).
  const [signedIn, setSignedIn] = useState('');
  const [form, setForm] = useState({ open: false, email: '', password: '', busy: false, error: '' });
  const token = signedIn || linkToken;

  const buyer = useMemo(() => readUpgradeToken(token), [token]);
  const expired = !!buyer && buyer.exp * 1000 <= now;

  useEffect(() => {
    const prev = document.title;
    document.title = 'GameGuide · Plans';
    window.scrollTo({ top: 0, behavior: 'instant' });
    return () => { document.title = prev; };
  }, []);

  // Live prices, open payment methods and the buyer's current plan.
  useEffect(() => {
    if (!billingOpen()) return undefined;
    const ctrl = new AbortController();
    fetchPlans(buyer && !expired ? token : '', { signal: ctrl.signal }).then(setLive).catch(() => setLive(null));
    return () => ctrl.abort();
  }, [token, buyer, expired]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rails = live?.rails || { card: null, upi: null };
  // If the preferred way to pay is not open, use the one that is.
  const railKey = live && !rails[rail] ? (rails.card ? 'card' : rails.upi ? 'upi' : rail) : rail;

  useScene(rootRef, ({ calm: still }, root) => {
    if (still) return;
    gsap.from(root.querySelectorAll('[data-intro]'), { y: 20, opacity: 0, duration: 0.8, stagger: 0.07, ease: 'power3.out' });
  }, [calm]);

  const currency = railKey === 'upi' ? 'inr' : 'usd';
  const railNow = rails[railKey];
  const account = live?.account || null;
  const tier = account?.tier || 'free';
  const minutesLeft = buyer ? Math.max(0, Math.round((buyer.exp * 1000 - now) / 60_000)) : 0;
  const linked = !!buyer && !expired && !live?.linkExpired;
  const open = billingOpen() && !!live && (rails.card || rails.upi);

  /** Why a button is off, or '' when it can be pressed. */
  const blocked = (plan, iv) => {
    if (!billingOpen() || (live && !rails.card && !rails.upi)) return 'Payments open soon.';
    if (!linked) return 'Run /upgrade in Discord to link your account first.';
    if (!live) return 'Loading…';
    if (!sells(railNow, plan, iv)) return 'Not available with this payment method — try the other one.';
    if (plan === 'server' && !buyer.inServer) return 'Run /upgrade inside the server you want to upgrade.';
    if (plan === 'pro' && tier === 'pro' && account?.status !== 'ending') return 'This is your plan.';
    if (tier === 'lifetime' && plan !== 'server') return 'You have Lifetime.';
    if (plan === 'server' && tier === 'server') return 'This server already has it.';
    return '';
  };

  const submitSignIn = async (e) => {
    e.preventDefault();
    setForm(f => ({ ...f, busy: true, error: '' }));
    try {
      const t = await signIn(form.email, form.password);
      try { sessionStorage.setItem('gg.upgradeToken', t); } catch { /* still signed in for this view */ }
      setSignedIn(t);
      setForm({ open: false, email: '', password: '', busy: false, error: '' });
    } catch (err) {
      setForm(f => ({ ...f, busy: false, error: err.message === 'bad-login' ? 'That email and password do not match.' : err.message === 'slow-down' ? 'Too many tries — wait a few minutes.' : 'Sign-in is not available right now.' }));
    }
  };

  const buy = async (plan, iv) => {
    setError('');
    setBusy(`${plan}:${iv}`);
    try {
      const url = await startCheckout({ token, plan, interval: iv, rail: railKey });
      window.location.assign(url);
    } catch (e) {
      setError(CHECKOUT_ERRORS[e.message] || 'Something went wrong starting the payment. Please try again.');
      setBusy('');
    }
  };

  const price = (plan, iv) => {
    const o = iv === 'once' ? plan.lifetime : plan.offers?.[iv];
    return o ? money(o[currency], currency) : '';
  };
  const perMonth = (plan) => {
    const y = plan.offers?.year?.[currency];
    if (!y) return '';
    return currency === 'inr' ? `₹${Math.round(y / 12).toLocaleString('en-IN')}` : `$${(y / 1200).toFixed(2)}`;
  };
  const saving = yearlySaving(PRO.offers, currency);
  const proBlocked = blocked('pro', period);
  const lifeBlocked = blocked('lifetime', 'once');
  const serverBlocked = blocked('server', period);

  const links = [
    { label: 'About', onClick: () => onNavigate?.('about') },
    { label: 'Plans', onClick: () => {}, current: true },
    { label: 'Contact', onClick: () => onNavigate?.('contacts') },
  ];

  return (
    <div ref={rootRef} className={`site s-info s-upgrade${calm ? ' is-calm' : ''}`} style={{ '--s-game-accent': game.accent }}>
      <a className="s-skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <SiteNav links={links} onBrand={onLogo} cta={{ label: 'Open GameGuide', onClick: () => onNavigate?.('chat') }} />

      <div className="s-page-head">
        <div className="s-page-head__art" aria-hidden="true">
          <img src={heroArt(game.appid)} alt="" decoding="async" />
        </div>
        <div className="s-wrap s-page-head__inner">
          <button type="button" className="s-back" onClick={onBack} data-intro>
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          <div data-intro><Overline>GameGuide · Plans</Overline></div>
          <h1 className="s-h1" data-intro>{thanks ? 'You’re in.' : 'Pick your plan.'}</h1>
          <p className="s-lead" data-intro>
            {thanks
              ? 'Payment received. Your plan switches on in Discord within a minute — check it with /quota.'
              : 'Monthly, yearly or once. Cancel any time and the plan stays on until the end of what you paid for.'}
          </p>
        </div>
      </div>

      <main id="main" tabIndex={-1} className="s-wrap s-page">
        {thanks ? (
          <section className="s-thanks" data-intro>
            <p className="s-prose">
              A receipt is on its way to your email. If the plan has not shown up in <strong>/quota</strong> after
              a few minutes, write to <a className="s-a" href={mailto('My GameGuide plan did not arrive')}>{LINKS.email}</a> with
              the receipt and it will be sorted the same day.
            </p>
            <a className="s-btn s-btn--primary" href="https://discord.com/app">Back to Discord</a>
          </section>
        ) : (
          <>
            <div className="s-upgrade__who" role="status" data-intro>
              {linked ? (
                <p>
                  <ShieldCheck size={16} aria-hidden="true" />
                  {buyer.name === 'Test account'
                    ? <>Signed in as the <strong>test account</strong> — payments here are test payments</>
                    : <>Buying for <strong>{buyer.name ? `@${buyer.name}` : 'your Discord account'}</strong></>}
                  {buyer.inServer ? ' · server plans apply to the server you opened this from' : ''}
                  <span className="s-upgrade__ttl">link valid {minutesLeft} min</span>
                </p>
              ) : (
                <p>
                  <Lock size={16} aria-hidden="true" />
                  {buyer
                    ? <>This link has expired. Run <code>/upgrade</code> in Discord for a fresh one.</>
                    : <>To buy, run <code>/upgrade</code> in Discord — its link opens this page already signed in as you.</>}
                  <a className="s-a" href={LINKS.discordInvite} target="_blank" rel="noopener noreferrer">Add GameGuide to Discord</a>
                  {billingOpen() && !form.open && (
                    <button type="button" className="s-linkbtn" onClick={() => setForm(f => ({ ...f, open: true }))}>
                      Sign in with email
                    </button>
                  )}
                </p>
              )}
              {!linked && form.open && (
                <form className="s-signin" onSubmit={submitSignIn} aria-label="Sign in with email">
                  <label>
                    <span>Email</span>
                    <input type="email" autoComplete="username" required value={form.email}
                      onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
                  </label>
                  <label>
                    <span>Password</span>
                    <input type="password" autoComplete="current-password" required value={form.password}
                      onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} />
                  </label>
                  <button type="submit" className="s-btn s-btn--primary s-btn--sm" disabled={form.busy}>
                    {form.busy ? 'Signing in…' : 'Sign in'}
                  </button>
                  <p className="s-signin__note">
                    For test and review accounts. Players link their account by running <code>/upgrade</code> in Discord.
                  </p>
                  {form.error && <p className="s-signin__error" role="alert">{form.error}</p>}
                </form>
              )}
              {account && tier !== 'free' && (
                <p className="s-upgrade__current">
                  Current plan: <strong>{{ pro: 'Pro', lifetime: 'Pro Lifetime', server: 'Premium Server' }[tier]}</strong>
                  {account.status === 'ending' ? ' · cancelled, on until the end of the paid period' : ''}
                  {account.status === 'past_due' ? ' · last payment failed — update your card from the receipt email' : ''}
                </p>
              )}
            </div>

            <div className="s-upgrade__controls" data-intro>
              <Segmented
                label="Billing period"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'month', label: 'Monthly' },
                  { value: 'year', label: 'Yearly', note: saving ? `save ${saving}%` : '' },
                ]}
              />
              {(!live || (rails.card && rails.upi)) && (
                <Segmented
                  label="Payment method"
                  value={railKey}
                  onChange={setRail}
                  options={[
                    { value: 'card', label: 'Card · worldwide', note: 'USD' },
                    { value: 'upi', label: 'UPI & Indian cards', note: 'INR' },
                  ]}
                />
              )}
            </div>

            {error && <p className="s-upgrade__error" role="alert">{error}</p>}

            <div className="s-plans">
              {/* Pro leads: it is the plan most people want, so it gets the room. */}
              <article className="s-plan s-plan--feature" aria-labelledby="plan-pro" data-intro>
                <header className="s-plan__head">
                  <p className="s-plan__badge">Most popular</p>
                  <h2 id="plan-pro" className="s-plan__name">{PRO.name}</h2>
                  <p className="s-plan__tag">{PRO.tagline}</p>
                </header>
                <p className="s-plan__price">
                  <span className="s-plan__amount">{price(PRO, period)}</span>
                  <span className="s-plan__per">{period === 'year' ? `/year · ${perMonth(PRO)} a month` : '/month'}</span>
                </p>
                <Features items={PRO.features} />
                <div className="s-plan__actions">
                  <button
                    type="button"
                    className="s-btn s-btn--primary s-btn--lg"
                    disabled={!!proBlocked || !!busy}
                    onClick={() => buy('pro', period)}
                  >
                    {busy === `pro:${period}` ? 'Opening checkout…' : tier === 'pro' ? 'Your plan' : `Get Pro ${period === 'year' ? 'yearly' : 'monthly'}`}
                  </button>
                  {proBlocked && tier !== 'pro' && <p className="s-plan__why">{proBlocked}</p>}
                </div>
                <div className="s-plan__once">
                  <div>
                    <p className="s-plan__once-name">Pro Lifetime · {price(PRO, 'once')} once</p>
                    <p className="s-plan__once-note">
                      Everything in Pro, for good — no renewals.
                      {tier === 'pro' ? ' Cancel your monthly or yearly plan from the receipt email so it does not renew.' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="s-btn s-btn--ghost"
                    disabled={!!lifeBlocked || !!busy}
                    onClick={() => buy('lifetime', 'once')}
                  >
                    {busy === 'lifetime:once' ? 'Opening…' : tier === 'lifetime' ? 'You have it' : 'Pay once'}
                  </button>
                </div>
              </article>

              <div className="s-plans__side">
                <article className="s-plan" aria-labelledby="plan-server" data-intro>
                  <header className="s-plan__head">
                    <h2 id="plan-server" className="s-plan__name">{SERVER.name}</h2>
                    <p className="s-plan__tag">{SERVER.tagline}</p>
                  </header>
                  <p className="s-plan__price">
                    <span className="s-plan__amount">{price(SERVER, period)}</span>
                    <span className="s-plan__per">{period === 'year' ? `/year · ${perMonth(SERVER)} a month` : '/month'}</span>
                  </p>
                  <Features items={SERVER.features} />
                  <div className="s-plan__actions">
                    <button
                      type="button"
                      className="s-btn s-btn--ghost"
                      disabled={!!serverBlocked || !!busy}
                      onClick={() => buy('server', period)}
                    >
                      {busy === `server:${period}` ? 'Opening checkout…' : 'Upgrade this server'}
                    </button>
                    {serverBlocked && <p className="s-plan__why">{serverBlocked}</p>}
                  </div>
                </article>

                <article className="s-plan s-plan--quiet" aria-labelledby="plan-free" data-intro>
                  <header className="s-plan__head">
                    <h2 id="plan-free" className="s-plan__name">{FREE.name}</h2>
                    <p className="s-plan__tag">{FREE.tagline}</p>
                  </header>
                  <p className="s-plan__price"><span className="s-plan__amount">{money(0, currency)}</span></p>
                  <Features items={FREE.features} />
                  {tier === 'free' && linked && <p className="s-plan__why">Your current plan.</p>}
                </article>
              </div>
            </div>

            {!open && (
              <p className="s-upgrade__note" data-intro>
                {billingOpen() ? 'Checking which payment methods are open…' : 'Paid plans open soon — prices above are final.'}
              </p>
            )}

            <section className="s-prose s-upgrade__faq" aria-label="Questions">
              <h2 className="s-h2">Questions</h2>
              <p><strong>How do I cancel?</strong> From the link in your receipt email. The plan stays on until the end of the period you paid for, then you are back on Free — nothing else changes.</p>
              <p><strong>How do I pay?</strong> By card anywhere in the world, or with UPI, netbanking and Indian cards in rupees. Payments are handled by the payment provider; GameGuide never sees your card or UPI details.</p>
              <p><strong>Monthly or yearly?</strong> Yearly costs ten months for twelve. Lifetime is a single payment for Pro, for good.</p>
              <p><strong>Something went wrong?</strong> Write to <a className="s-a" href={mailto('GameGuide plan question')}>{LINKS.email}</a>.</p>
            </section>
          </>
        )}
      </main>

      <SiteFooter onNavigate={onNavigate} onStart={() => onNavigate?.('chat')} />
    </div>
  );
}
