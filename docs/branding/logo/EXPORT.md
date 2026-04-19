# Logo Export Checklist

## Primary files

| File | Purpose | Dimensions |
|------|---------|------------|
| `conflux-devkit-mark.svg` | Square app icon and submission logo | 1024x1024 |
| `conflux-devkit-wordmark.svg` | Horizontal wordmark for README headers | 1400x340 |
| `conflux-devkit-badge-dark.svg` | Dark lockup for decks, social, repo visuals | 1200x400 |
| `conflux-devkit-badge-light.svg` | Light lockup for documents/white backgrounds | 1200x400 |
| `favicon.svg` | Small browser/extension mark | 256x256 |

## Exports to create first

```
logo-500.png     ← conflux-devkit-mark.svg   (500x500, transparent bg)
logo-1000.png    ← conflux-devkit-mark.svg   (1000x1000, transparent bg)
logo-dark-bg.png ← conflux-devkit-badge-dark.svg
logo-light-bg.png← conflux-devkit-badge-light.svg
```

## Export guidance

- Use transparent background for the square mark PNGs
- Keep at least 10% padding around the icon when exporting for submission
- Do not stretch the wordmark into a square logo slot
- For profile images and tiny favicons, use `favicon.svg`

## Quick export methods

- **Figma**: import SVG, export PNG at 1x and 2x
- **Inkscape**: File > Export PNG Image, set target dimensions
- **Chrome**: open SVG, screenshot (preview only — use a real tool for deliverables)
- **CLI**: `npx svgexport mark.svg logo-1000.png 1000:1000`
