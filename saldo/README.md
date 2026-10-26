# FinSolution

Phone ledger with no login and no storefront. The interface is English. Cards and the bottom bar use [Liquid Glass](https://github.com/Kyant0/AndroidLiquidGlass) over a colored field, so the blur is the wallpaper behind them. The Android navigation bar stays hidden until a swipe up from the bottom edge.

- Home: balance, this month's income and expenses, recent entries
- Income and expenses by month
- Insights: category ring and six months of expenses (Vico)
- Credit calculator, annuity
- Entries stay in a file on the phone
- On launch the app reads `https://dash.ref2b.com/saldo/version.json`. A higher `versionCode` downloads the APK without cache and opens the Android installer. If that fails, the banner opens the same file in the browser

Install: https://dash.ref2b.com/saldo/

The APK response must keep an ETag, `Accept-Ranges`, and `Cache-Control: public`. `no-store` and `Pragma: no-cache` make Android Chrome and the in-app downloader abort a file that nginx has already finished sending. `version.json` stays uncached. A dropped download is continued with a `Range` request.

The release is signed with the key in `keystore/`, which is not committed. A copy of the key lives on the server in `/root/saldo-signing/`. A new build must use the same key, or Android will refuse to install it over the previous one.

The typeface is Plus Jakarta Sans, OFL.
