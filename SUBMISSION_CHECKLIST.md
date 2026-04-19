# Global Hackfest 2026 — Submission Checklist
**Deadline: 2026-04-20 @ 11:59:59**
**Project: devkit-workspace**

---

## Root Submission Contents

This repository root now contains the submission-facing files directly:

- `README.md` — public project overview and hackathon README
- `links.md` — canonical tracker for submission URLs
- `demo/README.md` — demo asset summary
- `demo/screenshots/` — screenshot pack
- `presentation.pdf` — pitch deck PDF
- `REFERENCE_LINKS.md` — official reference links

---

## Completed

- Root README is public-facing and submission-ready
- Demo video is uploaded: `https://youtu.be/HQ7EJWGkwzQ`
- Screenshot pack is included under `demo/screenshots/`
- Pitch deck PDF is present at `presentation.pdf`
- ExampleCounter testnet deployment is documented
- Live demo URL is documented
- License file is present

---

## Remaining Before Final Submission

- Confirm the GitHub repository is public
- Re-run `pnpm install && pnpm build` from a clean clone and record the result
- Verify the demo video still satisfies the 3–5 minute requirement
- Record and upload the participant intro video
- Create the Electric Capital PR and add its URL to `links.md`
- Publish the social post and add its URL to `links.md`
- Create the hackathon fork and submission PR

---

## Final Packaging Checklist

| Item | Required | Location | Status |
|------|----------|----------|--------|
| Public GitHub repo | ✅ | repository settings | Needs attention |
| Public README | ✅ | `README.md` | Done |
| License file | ✅ | `LICENSE` | Done |
| Links tracker | ✅ | `links.md` | Done |
| Demo video link | ✅ | `README.md`, `links.md` | Done |
| Participant intro video | ✅ | `links.md` | Missing |
| Screenshot pack | ✓ optional | `demo/screenshots/` | Done |
| Pitch deck PDF | ✓ optional | `presentation.pdf` | Done |
| Electric Capital PR | ✅ | `links.md` | Missing |
| Social post | ✅ | `links.md` | Missing |
| Deployed contract info | ✅ | `README.md` | Done |
| Hackathon submission PR | ✅ | `links.md` | Missing |

---

## Submission Structure For The Hackathon Repo

```text
devkit-workspace/
├── README.md
├── links.md
├── demo/
│   ├── README.md
│   └── screenshots/
└── presentation.pdf
```

---

## Key Links

| Resource | URL |
|----------|-----|
| Hackathon repo | https://github.com/conflux-fans/global-hackfest-2026 |
| Submission guide | https://github.com/conflux-fans/global-hackfest-2026/blob/main/docs/07_submission-guide.md |
| Checklist doc | https://github.com/conflux-fans/global-hackfest-2026/blob/main/docs/06_submission_checklist.md |
| README template | https://github.com/conflux-fans/global-hackfest-2026/blob/main/templates/project_readme.md |
| Electric Capital repo | https://github.com/electric-capital/open-dev-data |
| EC example PR | https://github.com/electric-capital/open-dev-data/pull/2475 |
| Testnet faucet | https://efaucet.confluxnetwork.org |
| ConfluxScan (testnet) | https://evmtestnet.confluxscan.org |
| Grant proposals forum | https://forum.conflux.fun/c/English/grant-proposals |
