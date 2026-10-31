# Payments: status and go-live checklist

Two rails, one set of rules (`billing-core.js`):
- **Razorpay:** rupees, UPI and Indian cards, for buyers in India.
- **PayPal:** dollars, a PayPal balance or a card through PayPal, for everyone else.

Plans live in `plans.js`:

| Plan | Monthly | Yearly | Once |
|---|---|---|---|
| Base | $2.99 / ₹199 | $29.99 / ₹1,999 | |
| Pro | $4.99 / ₹399 | $49.99 / ₹3,999 | |
| Server | $14.99 / ₹1,199 | $149.99 / ₹11,999 | |
| Pro Lifetime | | | $39.99 / ₹3,299 |

All commands below run from `discord-bot/`.

## Where things stand (31 Oct 2026)

| Piece | State |
|---|---|
| Code (PRs #15, #17–#20) | merged, CI green, deployed |
| Bot on Render (`gameguide-bot-7cf4.onrender.com`) | live, billing on: Razorpay **test**, PayPal **sandbox** |
| Website plans page | live, offers UPI and PayPal, 4 plans |
| Database (Base tier, quota function) | migrated |
| Razorpay test plans, PayPal sandbox plans and webhook | created, checked against the providers (31/31) |
| Razorpay webhook | **secret in the dashboard form is wrong.** Every event is refused. Fix below. |
| PayPal sandbox purchase | **not yet done.** Needs a US sandbox buyer. Fix below. |
| Live keys | not yet |

## A. Finish test mode

1. **Razorpay webhook secret.** Run `node scripts/razorpay-webhook.js`.
   - It copies only the secret to your clipboard and prints the URL and the events to tick.
   - In Razorpay (Test mode), go to Webhooks and edit the webhook. Clear the Secret field, paste, and save.
   - Check it worked with `node scripts/billing-go-live.js --diagnose`. There should be no new `signature verification failed` lines.
2. **US sandbox buyer.** On developer.paypal.com, go to Testing Tools → Sandbox Accounts → Create account → Personal, country **United States**.
3. **PayPal test purchase.** Run `node scripts/paypal-sandbox-test.js`.
   - It prints a checkout link for the bot's test identity.
   - Log in with the US sandbox buyer and press Subscribe.
   - The script waits until PayPal shows the subscription as paid and the bot has granted the plan, then prints PASS and cleans up.
4. **Razorpay test purchase.** Run `/upgrade` in Discord, choose UPI, and pay with `success@razorpay`. `/quota` should change within a minute.

## B. Switch to live (real money)

1. **Razorpay:** switch the dashboard to Live mode, go to API Keys, and generate a key. Put both values in `.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. **PayPal:** on developer.paypal.com, switch to **Live**, go to Apps & Credentials, and create an app (Merchant). Put the client ID and secret in `.env`, and set `PAYPAL_ENV=live`.
3. Run `node scripts/billing-go-live.js`.
   - It creates the live plans and the live PayPal webhook.
   - It copies everything to Render, redeploys, and checks the result against the live providers.
   - Live plans are new ids, so the `*_PLAN_*` values are all replaced.
4. **Razorpay live webhook.** Run `node scripts/razorpay-webhook.js` and repeat step A1 in Live mode.
5. **One real purchase.** Buy Base monthly yourself with UPI, check `/quota`, then refund it from the Razorpay dashboard.
6. **Turn off the review sign-in** once Razorpay's review is over: delete `REVIEW_LOGIN_EMAIL` and `REVIEW_LOGIN_PASSWORD` from `.env.render` and from Render.

## Day to day

| Need | Do |
|---|---|
| Is everything healthy? | `node scripts/billing-check.js --bot https://gameguide-bot-7cf4.onrender.com` |
| Bot logs | `node scripts/billing-go-live.js --diagnose` |
| Someone paid but has no plan | `node scripts/billing-sync.js --apply` (Razorpay). For PayPal, check the logs, then the subscription in PayPal. |
| Refund | From the provider's dashboard. A full refund of Lifetime takes the plan back automatically. A subscription runs to the end of its period once cancelled. |
| Price change | Edit `plans.js` and `src/site/pricing.js`, then run the setup scripts (new plans are created; old subscribers keep their price). |
