# ibrarchitech.com

Ibrahim A. Fallatah · architecture and creative work.

- `/academy/` — Cinematic Arts Academy, Jeddah (English), `/academy/ar/` (Arabic)
- `/academy/survey/` — the survey, with the Google Form embedded
- `/academy/partners/` — for partners

Plain HTML, served by GitHub Pages. `CNAME` holds the domain. The root `index.html` sends visitors to
`/academy/` for now; replace it with the portfolio home page later, and every `/academy/` link keeps working.

## Security notes

- No third-party scripts, trackers or analytics. Fonts are served from `academy/assets/fonts/` (SIL Open Font License).
- Every page carries a Content-Security-Policy `<meta>`: only this site's own files may run or load, and only
  `https://docs.google.com` may be framed (the survey). If you add a YouTube or Vimeo embed, analytics or a
  contact-form service later, add its address to that line or the browser will block it.
- `.well-known/security.txt` tells people where to report a problem with the site.
- Keep two-step sign-in on GitHub, Hostinger and Gmail, and keep `ibrarchitech.com` verified in GitHub's Pages settings.

