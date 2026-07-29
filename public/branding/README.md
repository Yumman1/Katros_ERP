# Branding assets

| File | Background | Use |
| --- | --- | --- |
| `favicon.png` | transparent | App icon — the K mark alone. |
| `logo.png` | **black, opaque** | Full wordmark for the dark app shell. Despite the name this file is a JPEG, so it has no alpha and cannot sit on a light background. |
| `logo-white.png` | transparent | White wordmark for dark surfaces, used with `mix-blend-screen`. |
| `logo-print.png` | transparent | Full-colour wordmark for documents printed on white — contract notes, gate slips, delivery orders. |

## Why logo-print.png exists

`logo.png` is the brand-blue wordmark composited over black. On the dark shell
the black is invisible; on white paper it prints as a black box behind the logo.
`logo-white.png` is the opposite problem — white artwork disappears on white.

`logo-print.png` was derived from `logo.png` by treating its brightness as
coverage, un-premultiplying the colour so antialiased edges keep their true
hue instead of printing as a dark fringe, and cropping to the artwork. Both
brand colours are preserved exactly: blue `#2C3590` and green `#106939`.

If the company supplies an official transparent wordmark, replace this file —
nothing else needs to change.
