# DDUCL Design System

Extracted from https://dducl.com — the landing page for "Diário De Um Coffee Lover," Brazil's largest collective coffee buying group. Built with React + Tailwind CSS + shadcn/ui primitives.

---

## 1. Brand Identity

| Attribute | Value |
|-----------|-------|
| Brand | DDUCL (Diário De Um Coffee Lover) |
| Tagline | "Junte-se ao maior grupo de compras coletivas do Brasil." |
| Language | pt-BR |
| Logo | Square coffee-branded icon (WebP) |
| Theme Color | `#522b02` (deep espresso brown) |
| Style | Warm, artisanal, coffee-culture; dark hero with cream body |
| Tech Stack | React, Tailwind CSS, shadcn/ui, Radix UI, Vite |

---

## 2. Color Palette

### 2.1 Design Tokens (shadcn/ui CSS Custom Properties)

```css
:root {
  --background: 40 33% 96%;       /* #F5F0E8 — warm cream */
  --foreground: 0 0% 10%;         /* #1A1A1A — near-black */
  --card: 40 33% 98%;             /* #FCFAF7 — off-white card */
  --card-foreground: 0 0% 10%;
  --popover: 40 33% 98%;
  --popover-foreground: 0 0% 10%;
  --primary: 28 50% 33%;          /* #7E5025 — coffee brown */
  --primary-foreground: 40 33% 96%;
  --secondary: 35 30% 90%;        /* #EAE4D9 — light tan */
  --secondary-foreground: 0 0% 10%;
  --muted: 35 20% 92%;            /* #EEEAE2 — muted cream */
  --muted-foreground: 0 0% 40%;   /* #666666 — muted text */
  --accent: 35 30% 90%;           /* same as secondary */
  --accent-foreground: 0 0% 10%;
  --destructive: 10 60% 40%;      /* #A33D2E — error red */
  --destructive-foreground: 210 40% 98%;
  --border: 35 20% 85%;           /* #E0DAD1 — subtle border */
  --input: 35 20% 85%;
  --ring: 28 50% 33%;             /* matches primary */
  --radius: 0.5rem;               /* 8px base radius */
}

/* Brand-specific tokens */
:root {
  --coffee-dark: 28 100% 16%;     /* #522600 — deepest espresso */
  --coffee-cream: 40 33% 96%;     /* #F5F0E8 — background cream */
  --coffee-gold: 42 75% 31%;      /* #8A6714 — warm gold accent */
  --live: 142 71% 38%;            /* #1BBF46 — live/active green */
  --live-soft: 142 60% 95%;       /* #E8F8EC — soft green bg */
  --live-border: 142 50% 80%;     /* #A8E6B8 — green border */
}
```

### 2.2 Dark Mode

```css
.dark {
  --background: 0 0% 10%;         /* #1A1A1A */
  --foreground: 40 33% 96%;       /* #F5F0E8 (inverted) */
  --primary: 42 75% 45%;          /* #C9981D — brighter gold */
  --primary-foreground: 0 0% 10%;
  --ring: 42 75% 45%;
}
```

### 2.3 Extended Palette

| Role | Hex | HSL | Usage |
|------|-----|-----|-------|
| Deep Espresso | `#522600` | `28 100% 16%` | Hero backgrounds, dark sections, text on cream |
| Coffee Brown | `#7E5025` | `28 50% 33%` | Primary buttons, links, borders, icons |
| Warm Gold | `#BB811B` | `38 75% 42%` | Gradient accents, badges, decorative elements |
| Dark Gold | `#8A6714` | `42 75% 31%` | Secondary accents, hover states |
| Background Cream | `#F5F0E8` | `40 33% 96%` | Page background |
| Card Cream | `#FCFAF7` | `40 33% 98%` | Card/container surfaces |
| Light Cream | `#FCF9F4` | custom | Lighter surface variant |
| Warm Gray | `#F6F3EE` | custom | Alternate section bg |
| Light Tan | `#EAE4D9` | `35 30% 90%` | Secondary buttons, muted areas |
| Muted Cream | `#EEEAE2` | `35 20% 92%` | Muted backgrounds |
| Border Tan | `#E0DAD1` | `35 20% 85%` | Borders, dividers |
| Text Dark | `#2C1810` | custom | Primary body text |
| Text Medium | `#5C4A3A` | custom | Secondary body text |
| Text Muted | `#8C7E6A` | custom | Tertiary/muted text |
| Text Light | `#C4B8A8` | custom | Very muted (dark bg) |
| Success Green | `#1BBF46` | `142 71% 38%` | Live/active indicators |
| Destructive Red | `#A33D2E` | `10 60% 40%` | Errors, destructive actions |
| WhatsApp Green | `#25D366` | custom | WhatsApp CTA buttons |
| Peach | `#FDCB9B` | custom | Warm accent backgrounds |

### 2.4 Opacity Variants

The design uses extensive opacity-based color variants especially for borders and backgrounds:

- `coffee-dark/{5,10,15,20,25,30,60,80}` — layered brown overlays
- `coffee-gold/{10,20,30}` — layered gold accents
- `primary/{5,10,20,30,90}` — primary brown variants
- `muted/{10,20,30,40,50,60}` — muted cream variants
- `border/{10,20,30,40,50,60}` — subtle borders

---

## 3. Typography

### 3.1 Font Families

| Role | Family | Weights | Usage |
|------|--------|---------|-------|
| Display | `'Bricolage Grotesque', sans-serif` | 300, 400, 500 | Hero headings, section titles, brand text |
| Body | `'Inter', sans-serif` | 400, 500, 600 | Body text, UI elements, buttons, forms |
| Mono | `ui-monospace, SFMono-Regular, ...` | 400 | Code, technical content |

Loaded from Google Fonts:
```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@300;400;500&family=Inter:wght@400;500;600
```

### 3.2 Type Scale

| Level | Utility Class | Size | Line Height | Weight | Usage |
|-------|-------------|------|-------------|--------|-------|
| Display XL | `text-6xl` | 3.75rem (60px) | 1 | 300 | Landing hero (desktop) |
| Display | `text-5xl` | 3rem (48px) | 1 | 300/400 | Section heroes |
| Heading 1 | `text-4xl` | 2.25rem (36px) | 2.5rem | 300/500 | Major section headings |
| Heading 2 | `text-3xl` | 1.875rem (30px) | 2.25rem | 400/500 | Section headings |
| Heading 3 | `text-2xl` | 1.5rem (24px) | 2rem | 500/600 | Card headings |
| Heading 4 | `text-xl` | 1.25rem (20px) | 1.75rem | 500/600 | Subsection headings |
| Body Large | `text-lg` | 1.125rem (18px) | 1.75rem | 400 | Featured body text |
| Body | `text-base` | 1rem (16px) | 1.5rem | 400/500 | Default body |
| Body Small | `text-sm` | 0.875rem (14px) | 1.25rem | 400/500 | Secondary text, labels |
| Caption | `text-xs` | 0.75rem (12px) | 1rem | 400/500 | Captions, meta |
| Micro | `text-[10px]` | 10px | 1 | 500 | Badges, overlines |

### 3.3 Line Height Variants

| Token | Value | Usage |
|-------|-------|-------|
| `leading-none` | 1 | Display/hero text |
| `leading-[1.15]` | 1.15 | Tight headings |
| `leading-tight` | 1.25 | Headings |
| `leading-snug` | 1.375 | Subheadings |
| `leading-normal` | 1.5 | Body text (default) |
| `leading-relaxed` | 1.625 | Relaxed body |

### 3.4 Letter Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `tracking-tighter` | -0.05em | Display text |
| `tracking-tight` | -0.025em | Headings |
| `tracking-normal` | 0 | Body (default) |
| `tracking-wide` | 0.025em | Small text |
| `tracking-wider` | 0.05em | Labels |
| `tracking-widest` | 0.1em | Overlines, badges |
| Custom | `0.15em` - `0.3em` | Uppercase overline labels |

---

## 4. Spacing Scale

Uses standard Tailwind 4px base unit. Common spacing patterns observed:

| Token | Size | Usage |
|-------|------|-------|
| `p-1` / `gap-1` | 4px | Tight icon+label |
| `p-2` / `gap-2` | 8px | Compact inline |
| `p-3` / `gap-3` | 12px | Compact cards, form groups |
| `p-4` / `gap-4` | 16px | **Default card padding** |
| `p-6` / `gap-6` | 24px | Comfortable card padding |
| `p-8` / `gap-8` | 32px | Section interiors |
| `px-10` / `py-10` | 40px | Large sections |
| `py-16` | 64px | Section vertical padding |
| `py-20` | 80px | Hero section padding |
| `py-24` | 96px | Major section divider |
| `py-32` | 128px | Extra large section |

**Container**: `max-width: 1400px`, `padding: 2rem (32px)` horizontal.

**Section spacing**: `space-y-24` (96px) to `space-y-32` (128px) between major sections.

---

## 5. Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `rounded-none` | 0 | Table edges, seamless joins |
| `rounded-sm` | `calc(var(--radius) - 4px)` = 4px | Small elements |
| `rounded-md` | `calc(var(--radius) - 2px)` = 6px | Inputs, small cards |
| `rounded-lg` | `var(--radius)` = **8px** | **Default — cards, buttons, modals** |
| `rounded-xl` | 0.75rem = 12px | Larger cards |
| `rounded-2xl` | 1rem = 16px | Hero cards, featured containers |
| `rounded-[2.5rem]` | 40px | **Pill CTA buttons** |
| `rounded-full` | 9999px | Badges, avatars, icon containers |

---

## 6. Shadows & Elevation

Uses Tailwind's default shadow scale plus custom variants:

| Level | Token | Value | Usage |
|-------|-------|-------|-------|
| None | - | none | Flat elements |
| Subtle | `shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Cards on cream bg |
| Card | `shadow` | `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` | Default card elevation |
| Elevated | `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.1)` | Hover states, dropdowns |
| Modal | `shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.1)` | Modals, popovers |
| Heavy | `shadow-xl` | `0 20px 25px -5px rgb(0 0 0 / 0.1)` | Large modals |
| Overlay | Custom | `rgba(0,0,0,0.6)` | Hero image overlay |

**Dark overlay pattern**: `bg-black/60` or `bg-black/80` on top of background images for text readability.

---

## 7. Buttons

### 7.1 Variants

| Variant | Backround | Text Color | Border | Hover | Usage |
|---------|-----------|------------|--------|-------|-------|
| **Primary** | `bg-primary` (`#7E5025`) | `text-primary-foreground` (`#F5F0E8`) | none | `bg-primary/90` | Main CTAs |
| **Primary Light** | `bg-primary/10` | `text-primary` | `border-primary/20` | `bg-primary/20` | Secondary actions |
| **Gold CTA** | `bg-coffee-gold` (`#8A6714`) | `text-white` | none | Darker gold | Premium/special CTAs |
| **Outline** | `bg-transparent` | `text-coffee-dark` | `border` (tan) | Light bg overlay | Secondary CTAs |
| **Ghost** | `bg-transparent` | `text-muted-foreground` | none | `bg-muted` | Nav links, subtle actions |
| **Dark** | `bg-coffee-dark` (`#522600`) | `text-coffee-cream` | none | `bg-coffee-dark/80` | Dark section CTAs |
| **WhatsApp** | `bg-[#25D366]` | `text-white` | none | Darker green | WhatsApp CTA |
| **Destructive** | `bg-destructive` | `text-destructive-foreground` | none | Darker red | Delete/remove |
| **Destructive Outline** | `bg-destructive/10` | `text-destructive` | `border-destructive/30` | `bg-destructive/15` | Cancel/soft destructive |

### 7.2 Sizes

| Size | Height | Horizontal Padding | Font Size | Border Radius |
|------|--------|-------------------|-----------|---------------|
| **sm** | `h-8` (32px) | `px-3` (12px) | `text-sm` (14px) | `rounded-lg` (8px) |
| **md** (default) | `h-10` (40px) | `px-4` (16px) | `text-sm` (14px) | `rounded-lg` (8px) |
| **lg** | `h-11`-`h-12` (44-48px) | `px-6`-`px-8` (24-32px) | `text-base` (16px) | `rounded-lg` or `rounded-[2.5rem]` |
| **xl** | `h-14` (56px) | `px-10` (40px) | `text-lg` (18px) | `rounded-[2.5rem]` (40px pill) |
| **icon** | `h-10 w-10` | - | - | `rounded-lg` |

### 7.3 Button Style Patterns

```css
/* Primary CTA button (pill) */
.cta-pill {
  border-radius: 2.5rem;   /* 40px pill */
  padding: 0.75rem 2rem;   /* py-3 px-8 */
  font-size: 1rem;         /* text-base */
  font-weight: 500;        /* font-medium */
  background: hsl(28 50% 33%); /* #7E5025 */
  color: hsl(40 33% 96%);  /* cream */
  transition: all 0.2s ease;
}

/* Outline button */
.btn-outline {
  border-radius: var(--radius); /* 8px */
  padding: 0.5rem 1rem;    /* py-2 px-4 */
  font-size: 0.875rem;     /* text-sm */
  font-weight: 500;
  border: 1px solid hsl(var(--border));
  background: transparent;
  color: hsl(var(--coffee-dark));
}
```

---

## 8. Forms & Inputs

### 8.1 Input Fields

| State | Background | Border | Text | Ring |
|-------|-----------|--------|------|------|
| Default | `bg-background` | `border-input` (1px) | `text-foreground` | none |
| Focus | `bg-background` | `border-ring` | `text-foreground` | `ring-2 ring-ring ring-offset-2` |
| Disabled | `bg-muted/50` | `border-input` | `text-muted-foreground` | none |
| Error | `bg-destructive/5` | `border-destructive` | `text-foreground` | `ring-destructive` |
| Placeholder | - | - | `text-muted-foreground/50` | - |

```css
/* Standard input */
input {
  border-radius: var(--radius);        /* 8px */
  padding: 0.5rem 0.75rem;            /* py-2 px-3 */
  font-size: 0.875rem;                /* text-sm */
  height: 2.5rem;                     /* h-10 */
  border: 1px solid hsl(var(--input));
  background: transparent;
}
```

### 8.2 Select

Same styling as inputs, with chevron icon on right.

### 8.3 Labels & Helpers

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Label | `text-sm` | `font-medium` | `text-foreground` |
| Helper | `text-xs` | `font-normal` | `text-muted-foreground` |
| Error | `text-xs` | `font-medium` | `text-destructive` |

---

## 9. Cards & Containers

### 9.1 Card Variants

| Variant | Background | Border | Border Radius | Shadow | Padding |
|---------|-----------|--------|---------------|--------|---------|
| **Default** | `bg-card` (`#FCFAF7`) | `border` (tan) | `rounded-lg` (8px) | `shadow-sm` | `p-6` (24px) |
| **Elevated** | `bg-card` | `border` | `rounded-xl` (12px) | `shadow-md` | `p-6` |
| **Subtle** | `bg-muted/30` | none | `rounded-lg` | none | `p-4`-`p-6` |
| **Dark** | `bg-coffee-dark` | `border-coffee-dark/20` | `rounded-2xl` (16px) | `shadow-lg` | `p-8` |
| **Bordered Only** | `bg-transparent` | `border` | `rounded-lg` | none | `p-4`-`p-6` |

### 9.2 Card Anatomy

```
┌──────────────────────────────────┐
│ [Icon/Image]                      │  ← optional top image (aspect-video, rounded-t only)
│ ┌──────────────────────────────┐  │
│ │ Label / Badge                │  │  ← text-xs uppercase tracking-widest
│ │ Heading                      │  │  ← text-xl font-semibold
│ │ Description text...          │  │  ← text-sm text-muted-foreground
│ │                              │  │
│ │ [Button / Action]            │  │  ← mt-4
│ └──────────────────────────────┘  │
└──────────────────────────────────┘
  ↑ p-6 padding all around
```

### 9.3 Common Grid Layouts

| Context | Grid | Gap |
|---------|------|-----|
| Feature cards | `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` | `gap-6` |
| Product cards | `grid-cols-2 lg:grid-cols-4` | `gap-4` |
| Testimonials | `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` | `gap-6` |

---

## 10. Header / Navigation

### 10.1 Structure

```
┌──────────────────────────────────────────────────┐
│  sticky top-0 z-50 h-16 (64px)                   │
│  ┌────────┬──────────────────────────┬─────────┐  │
│  │ LOGO   │  Nav Links (center/right) │  CTA    │  │
│  └────────┴──────────────────────────┴─────────┘  │
│  bg-background/80 backdrop-blur                   │
│  border-b border-border                           │
└──────────────────────────────────────────────────┘
```

### 10.2 Header Properties

| Property | Value |
|----------|-------|
| Position | `sticky`, `top: 0`, `z-index: 50` |
| Height | `4rem` (64px) — `h-16` |
| Background | `bg-background/80` + `backdrop-blur` (frosted glass) |
| Border | `border-b border-border` |
| Scroll margin | `scroll-mt-20` (80px) — accounts for header + breathing room |
| Container | `max-w-1400px`, `mx-auto`, `px-8` |
| Logo height | ~`h-8` to `h-10` (32-40px) |

### 10.3 Nav Links

| State | Style |
|-------|-------|
| Default | `text-sm font-medium text-muted-foreground` |
| Hover | `text-foreground` |
| Active | `text-primary` |

### 10.4 Mobile

Hamburger menu trigger visible; full-screen or drawer-based mobile menu with backdrop.

---

## 11. Hero Banner

### 11.1 Hero Layout

```
┌──────────────────────────────────────────────────┐
│  Full viewport (h-screen / h-svh)                │
│  ┌──────────────────────────────────────────────┐│
│  │  Background Image (coffee-themed .webp)      ││
│  │  + Overlay: bg-black/60                      ││
│  │                                              ││
│  │        ┌────────────────────┐                ││
│  │        │   HERO HEADING     │                ││
│  │        │   (centered)       │                ││
│  │        │                    │                ││
│  │        │   Subheading       │                ││
│  │        │   [CTA Button]     │                ││
│  │        └────────────────────┘                ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

### 11.2 Hero Properties

| Element | Style |
|---------|-------|
| Container | `h-screen` or `h-svh`, `flex items-center justify-center`, `relative` |
| Background | `bg-[#1a0f05]` fallback + full-bleed coffee image |
| Overlay | `absolute inset-0 bg-black/60` (60% black overlay) |
| Text color | White (`#fff`) |
| Heading font | `font-bricolage`, `font-light` (300), `text-center` |
| Heading size | `clamp(1.875rem, 4vw, 3.75rem)` — responsive between 30px and 60px |
| Heading width | `max-w-3xl` (48rem / 768px) |
| Line height | `1.2` |
| Padding | `px-4` (mobile safety) |
| Z-index | Text at `z-10` above overlay |

### 11.3 Static Shell (Pre-JS)

The HTML delivers a static hero shell for fast LCP before React hydrates:

```html
<div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#1a0f05;position:relative">
  <div style="position:absolute;inset:0;background:rgba(0,0,0,.6)"></div>
  <h1 style="position:relative;z-index:10;text-align:center;color:#fff;font-family:'Bricolage Grotesque',sans-serif;font-weight:300;font-size:clamp(1.875rem,4vw,3.75rem);max-width:48rem;padding:0 1rem;line-height:1.2">
    Junte-se ao maior grupo de compras coletivas do Brasil.
  </h1>
</div>
```

---

## 12. Footer

### 12.1 Properties

| Property | Value |
|----------|-------|
| Background | `bg-coffee-dark` (`#522600`) — deep espresso |
| Text color | `text-coffee-cream` or `text-coffee-dark/60` (muted on dark) |
| Padding | `py-16` to `py-20` (64-80px vertical) |
| Layout | Multi-column grid: `grid-cols-2 lg:grid-cols-4` |
| Links | `text-sm text-coffee-dark/60 hover:text-coffee-cream` |
| Divider | `border-t border-coffee-dark/20` between sections |
| Bottom bar | `py-6` with copyright, social icons |

### 12.2 Footer Columns (typical)

| Column | Content |
|--------|---------|
| Brand | Logo + short description + social icons |
| Navigation | Quick links to main pages |
| Resources | Help, FAQ, contact |
| CTA/Newsletter | Email signup or final CTA |

---

## 13. Icons

| Property | Value |
|----------|-------|
| Library | **Lucide React** (inferred from shadcn/ui dependency) |
| Sizing | `size-4` (16px) default, `size-5` (20px) in buttons, `size-6` (24px) in hero |
| Color | `currentColor` — inherits from parent text color |
| Common colors | `text-muted-foreground` (muted), `text-primary` (accent), `text-coffee-dark` (headings) |
| Social icons | WhatsApp (`#25D366`), Instagram, Facebook |

---

## 14. Gradients

| Name | Direction | Stops | Usage |
|------|-----------|-------|-------|
| Gold CTA | `to right` | `from hsl(38,75%,42%)` → `via hsl(43,85%,55%)` → `to hsl(43,85%,55%)` | Premium buttons |
| Glass Overlay | `to right` | `from white/0` → `via white/10` → `to white/40` | Card overlays |
| Dark Fade | `to top` | `from coffee-dark/80` → `via transparent` → `to coffee-gold/10` | Section transitions |
| Conic Spin | `conic` | `#e8ddd0` → `#7E5025` → `#e8ddd0` | Loading/decoration |
| Cream Fade | `to br` | `from hsl(40,70%,45%)` → `via hsl(40,33%,97%)` → `to hsl(40,80%,55%)` | Section backgrounds |

---

## 15. Badges & Tags

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| Neutral | `bg-muted` | `text-muted-foreground` | none |
| Primary | `bg-primary/10` | `text-primary` | `border-primary/20` |
| Gold | `bg-amber-50` | `text-amber-700` | `border-amber-200` |
| Success | `bg-emerald-50` | `text-emerald-700` | `border-emerald-200` |
| Warning | `bg-amber-50` | `text-amber-700` | `border-amber-200` |
| Error | `bg-red-50` | `text-red-700` | `border-red-200` |
| Live | `bg-live-soft` | `text-live` | `border-live-border` |

```css
.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;     /* rounded-full */
  padding: 0.25rem 0.75rem;  /* py-1 px-3 */
  font-size: 0.75rem;        /* text-xs */
  font-weight: 500;          /* font-medium */
}
```

---

## 16. Animations & Transitions

### 16.1 Duration Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `duration-150` | 150ms | Micro-interactions, hover states |
| `duration-200` | 200ms | **Default — buttons, links, inputs** |
| `duration-300` | 300ms | Modals, drawers, dropdowns |
| `duration-500` | 500ms | Page transitions, larger animations |
| `duration-700` | 700ms | Emphasis animations |
| `duration-1000` | 1000ms | Slow reveals |

### 16.2 Easing Curves

| Token | Value | Usage |
|-------|-------|-------|
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Enter animations, hover on |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Accordion, collapsible |
| `ease-linear` | `linear` | Spinners, loaders |

### 16.3 Keyframe Animations

| Name | Description | Duration | Easing |
|------|-------------|----------|--------|
| `spin` | Full rotation (loaders) | 1s | linear |
| `pulse` | Opacity pulse (skeletons) | 2s | ease-in-out |
| `ping` | Scale + fade (notifications) | 1s | ease-out |
| `shimmer` | Translate sweep (skeleton shimmer) | 2.5s | ease-in-out |
| `shimmer-beam-sweep` | Diagonal beam sweep | 2.5s | ease-in-out |
| `accordion-down` | Height expand | variable | ease-in-out |
| `accordion-up` | Height collapse | variable | ease-in-out |
| `collapsible-down` | Height expand | variable | ease-in-out |
| `collapsible-up` | Height collapse | variable | ease-in-out |
| `enter` | Fade + translate in | 150ms | ease-out |
| `exit` | Fade + translate out | 150ms | ease-in |

### 16.4 Common Transition Patterns

```css
/* Default interactive transition */
transition-all duration-200

/* Button hover effect */
hover:scale-105 transition-transform duration-200

/* Modal/dialog enter */
animate-in fade-in-0 zoom-in-95 duration-200

/* Modal/dialog exit */
animate-out fade-out-0 zoom-out-95 duration-200

/* Skeleton loader */
animate-pulse bg-muted rounded-md

/* Skeleton shimmer */
animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent
```

### 16.5 Motion Preferences

```css
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;  /* disable smooth scroll */
  }
}
```

---

## 17. Responsive Breakpoints

Standard Tailwind breakpoints:

| Name | Min Width | Usage |
|------|-----------|-------|
| `sm` | 640px | Phones landscape |
| `md` | 768px | Tablets |
| `lg` | 1024px | Small laptops |
| `xl` | 1280px | Desktops |
| `2xl` | 1536px | Large screens |

**Max container**: `1400px` at 2xl breakpoint.

### Common Responsive Patterns

| Pattern | Mobile | Desktop |
|---------|--------|---------|
| Grid | `grid-cols-1` | `md:grid-cols-2 lg:grid-cols-3` |
| Navigation | Hamburger menu | Full horizontal nav |
| Hero heading | `text-4xl` | `text-6xl` |
| Cards | Full width | Fixed max-width per card |
| Footer | `grid-cols-1` | `lg:grid-cols-4` |
| Container padding | `px-4` | `px-8` |

---

## 18. Design Principles

From the extracted patterns, the DDUCL aesthetic follows these principles:

1. **Warm & Earthy** — Coffee browns, creams, and golds create an artisanal, premium coffee-culture feel
2. **High Contrast Hero** — Deep dark hero (`#1a0f05` + coffee image overlay) followed by light cream body (`#F5F0E8`) creates dramatic transition
3. **Pill CTAs** — Primary CTAs use 40px border-radius pills for a friendly, modern feel
4. **Layered Opacities** — Extensive use of low-opacity brand colors (5-30%) for borders and subtle backgrounds instead of separate color stops
5. **Frosted Glass Nav** — Sticky header uses `backdrop-blur` with semi-transparent background
6. **Bricolage Grotesque Headings** — The display font's quirky character (especially at light 300 weight) gives a distinctive, non-corporate personality
7. **Inter Body** — Clean, readable Inter for all UI and body text
8. **8px Radius Default** — Consistent `--radius: 0.5rem` across cards, inputs, and buttons
9. **Generous Whitespace** — Section spacing of 96-128px, card padding of 24px
10. **Subtle Borders** — Borders are low-contrast tan (`#E0DAD1`) rather than harsh grays

---

## 19. Component Library Dependencies

| Package | Usage |
|---------|-------|
| `tailwindcss` | Utility-first CSS framework |
| `tailwindcss-animate` | Animation utilities |
| `shadcn/ui` | Component primitives (Button, Card, Dialog, etc.) |
| `@radix-ui/*` | Headless UI primitives (Dialog, Popover, Select, NavigationMenu, etc.) |
| `lucide-react` | Icon library |
| `sonner` | Toast notifications |
| `react-router-dom` | Client-side routing |

---

## 20. Quick Reference: CSS Variable Map

```css
/* Copy-paste this block to bootstrap the design system */
:root {
  /* shadcn/ui standard tokens */
  --background: 40 33% 96%;
  --foreground: 0 0% 10%;
  --card: 40 33% 98%;
  --card-foreground: 0 0% 10%;
  --popover: 40 33% 98%;
  --popover-foreground: 0 0% 10%;
  --primary: 28 50% 33%;
  --primary-foreground: 40 33% 96%;
  --secondary: 35 30% 90%;
  --secondary-foreground: 0 0% 10%;
  --muted: 35 20% 92%;
  --muted-foreground: 0 0% 40%;
  --accent: 35 30% 90%;
  --accent-foreground: 0 0% 10%;
  --destructive: 10 60% 40%;
  --destructive-foreground: 210 40% 98%;
  --border: 35 20% 85%;
  --input: 35 20% 85%;
  --ring: 28 50% 33%;
  --radius: 0.5rem;

  /* DDUCL brand tokens */
  --coffee-dark: 28 100% 16%;
  --coffee-cream: 40 33% 96%;
  --coffee-gold: 42 75% 31%;
  --live: 142 71% 38%;
  --live-soft: 142 60% 95%;
  --live-border: 142 50% 80%;
}

.dark {
  --background: 0 0% 10%;
  --foreground: 40 33% 96%;
  --card: 0 0% 13%;
  --card-foreground: 40 33% 96%;
  --primary: 42 75% 45%;
  --primary-foreground: 0 0% 10%;
  --ring: 42 75% 45%;
}
```

---

*Generated from live CSS extraction of https://dducl.com. Last verified: July 2026.*
