# Submission Asset Map

Maps hackathon submission requirements to branding assets in this folder.

## Requirements (from reference links)

| Requirement | Format | Status |
|-------------|--------|--------|
| Project logo | Square, min 500x500, PNG/JPG | `logo/conflux-devkit-mark.svg` — export to PNG |
| README header | Badge or wordmark | `logo/conflux-devkit-badge-dark.svg` |
| Demo video title card | 1920x1080 | `video/demo-title-card.svg` |
| Demo video lower-third | 1920x1080 transparent | `video/intro-lower-third.svg` |
| Participant intro overlay | 1920x1080 transparent | `video/intro-lower-third.svg` |
| Social/OG preview | 1200x630 | `social/og-card.svg` |
| Pitch deck cover | 16:9 | `presentation/cover-slide.svg` |
| Screenshots | Framed composites | `screenshots/screenshot-frame.svg` |

## Export targets (minimum for submission)

```
logo-500.png         ← conflux-devkit-mark.svg (500x500, transparent)
logo-1000.png        ← conflux-devkit-mark.svg (1000x1000, transparent)
og-card.png          ← social/og-card.svg (1200x630)
cover-slide.png      ← presentation/cover-slide.svg (1600x900)
```

## Usage mapping

### Logo → Submission folder

- `logo/conflux-devkit-mark.svg` → export as `projects/conflux-devkit/logo.png`
- Same mark used as favicon, profile image, and small placements

### Video → Demo recording

- `video/demo-title-card.svg` → opening 3-5 second still in demo video
- `video/intro-lower-third.svg` → overlay during participant intro and talking segments

### Social → Twitter/X post

- `social/og-card.svg` → export as share image for social announcement

### Presentation → Optional pitch deck

- `presentation/cover-slide.svg` → first slide visual base

## Insertion points in project

1. Repo root `README.md` — badge or wordmark header image
2. `.generated/submission/01_project-readme/README.md` — logo and cover
3. `demo/screenshots/` — composites using screenshot frame
4. Demo video — title card and lower-third overlay
5. Pitch deck — cover slide visual
