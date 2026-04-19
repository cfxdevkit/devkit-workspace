# Conflux DevKit Branding Artifacts (Opus)

Improved branding source assets for the Global Hackfest 2026 submission.

## Improvements over the previous set

- **Better text safety**: all font sizes reduced to prevent overflow with fallback monospace fonts
- **Ambient glow effects**: radial gradients replace heavy line grids for a more polished look
- **Dot grid texture**: sparse dot patterns add depth without visual clutter
- **Consistent border radius**: 36px outer, 24px inner, 14-18px pills across all assets
- **Lighter border color**: `#1E344E` as primary border (less harsh than `#28405D`)
- **Feature pills**: OG card now has proper pill components instead of oversized badge boxes
- **Tighter lower-third**: 860px width (down from 940px) with better text proportions
- **Conservative font sizes**: max 96px for hero titles, 64px for standard titles

## Asset groups

```
brand/          → design system, tokens, submission mapping
logo/           → mark, wordmark, badges (dark/light), favicon
social/         → OG card (1200x630)
presentation/   → cover slide (1600x900)
video/          → demo title card + lower-third overlay
screenshots/    → screenshot frame template
```

## Recommended order

1. Export `logo/conflux-devkit-mark.svg` to 500x500 and 1000x1000 PNG
2. Use colors and type from `brand/brand-system.md`
3. Set `social/og-card.svg` as GitHub social preview
4. Use `presentation/cover-slide.svg` as pitch deck cover
5. Use `video/` assets in demo and intro videos
6. Frame screenshots with `screenshots/screenshot-frame.svg`

## Key specs

| Asset | Dimensions | Format |
|-------|-----------|--------|
| Logo mark | 1024x1024 | SVG → PNG |
| Favicon | 256x256 | SVG |
| Wordmark | 1400x340 | SVG |
| Badge (dark) | 1200x400 | SVG |
| Badge (light) | 1200x400 | SVG |
| OG card | 1200x630 | SVG → PNG |
| Cover slide | 1600x900 | SVG → PNG |
| Demo title card | 1920x1080 | SVG |
| Lower-third | 1920x1080 | SVG (transparent) |
| Screenshot frame | 1600x1000 | SVG |
