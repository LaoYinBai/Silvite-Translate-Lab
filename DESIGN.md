# Silvite Web Frontend Design System

> Unified design language synthesized from GitHub Primer, Brave Leo, Vercel Geist, Atlassian, Airbnb, Linear, Shadcn/ui, and other industry-leading design systems.

---

## 1. Design Principles

### Core Values
- **Clarity** — Every element should communicate its purpose without ambiguity
- **Consistency** — Unified visual language across all interfaces
- **Efficiency** — Minimize cognitive load through predictable patterns
- **Accessibility** — WCAG 2.1 AA compliant, inclusive by default

### Visual Philosophy
- **Developer-first minimalism** — Clean, functional, no decorative excess
- **Content-led hierarchy** — Chrome disappears, content leads
- **Systematic precision** — 4px grid, consistent spacing, mathematical scales

---

## 2. Color System

### Semantic Color Architecture

```css
:root {
  /* Canvas & Surface */
  --color-canvas: #ffffff;
  --color-canvas-subtle: #f6f8fa;
  --color-canvas-inset: #eff2f5;
  --color-surface: #ffffff;
  --color-surface-raised: #ffffff;
  
  /* Text Hierarchy */
  --color-text-primary: #1f2328;
  --color-text-secondary: #656d76;
  --color-text-tertiary: #8b949e;
  --color-text-placeholder: #afb8c1;
  --color-text-inverse: #ffffff;
  
  /* Brand & Accent */
  --color-accent: #0969da;
  --color-accent-hover: #0550ae;
  --color-accent-muted: #ddf4ff;
  --color-accent-emphasis: #0969da;
  
  /* Interactive States */
  --color-interactive: #0969da;
  --color-interactive-hover: #0550ae;
  --color-interactive-active: #033d8b;
  --color-interactive-disabled: #e1e4e8;
  
  /* Borders */
  --color-border-default: #d1d9e0;
  --color-border-muted: #e1e4e8;
  --color-border-emphasis: #1f2328;
  
  /* Feedback Colors */
  --color-success: #1a7f37;
  --color-success-subtle: #dafbe1;
  --color-warning: #bf8700;
  --color-warning-subtle: #fff8c5;
  --color-danger: #d1242f;
  --color-danger-subtle: #ffebe9;
  --color-info: #0969da;
  --color-info-subtle: #ddf4ff;
}
```

### Dark Mode

```css
[data-theme="dark"] {
  --color-canvas: #0d1117;
  --color-canvas-subtle: #161b22;
  --color-canvas-inset: #010409;
  --color-surface: #161b22;
  --color-surface-raised: #1c2128;
  
  --color-text-primary: #e6edf3;
  --color-text-secondary: #8b949e;
  --color-text-tertiary: #6e7681;
  --color-text-placeholder: #484f58;
  
  --color-accent: #58a6ff;
  --color-accent-hover: #79c0ff;
  --color-accent-muted: #0d2239;
  
  --color-border-default: #30363d;
  --color-border-muted: #21262d;
  --color-border-emphasis: #e6edf3;
}
```

---

## 3. Typography

### Font Stack

```css
:root {
  /* Primary Sans */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 
               'Noto Sans', Helvetica, Arial, sans-serif;
  
  /* Monospace */
  --font-mono: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', 
               'Courier New', monospace;
  
  /* Display */
  --font-display: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}
```

### Type Scale

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `display-xl` | 48px | 600 | 1.1 | -0.02em | Hero headlines |
| `display-lg` | 36px | 600 | 1.2 | -0.02em | Page titles |
| `display-md` | 30px | 600 | 1.25 | -0.01em | Section headers |
| `display-sm` | 24px | 600 | 1.33 | -0.01em | Card titles |
| `title-lg` | 20px | 600 | 1.4 | 0 | Subsection titles |
| `title-md` | 16px | 600 | 1.5 | 0 | Component titles |
| `body-lg` | 18px | 400 | 1.6 | 0 | Lead body text |
| `body-md` | 16px | 400 | 1.5 | 0 | Default body |
| `body-sm` | 14px | 400 | 1.43 | 0 | Secondary text |
| `caption` | 12px | 400 | 1.33 | 0.01em | Labels, captions |
| `code` | 14px | 400 | 1.6 | 0 | Inline code |
| `code-block` | 13px | 400 | 1.6 | 0 | Code blocks |

### Typography CSS

```css
:root {
  --text-display-xl: 600 48px/1.1 var(--font-display);
  --text-display-lg: 600 36px/1.2 var(--font-display);
  --text-display-md: 600 30px/1.25 var(--font-display);
  --text-display-sm: 600 24px/1.33 var(--font-display);
  --text-title-lg: 600 20px/1.4 var(--font-sans);
  --text-title-md: 600 16px/1.5 var(--font-sans);
  --text-body-lg: 400 18px/1.6 var(--font-sans);
  --text-body-md: 400 16px/1.5 var(--font-sans);
  --text-body-sm: 400 14px/1.43 var(--font-sans);
  --text-caption: 400 12px/1.33 var(--font-sans);
  --text-code: 400 14px/1.6 var(--font-mono);
}
```

---

## 4. Spacing System

### Base Unit: 4px

```css
:root {
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  
  /* Semantic Spacing */
  --space-tight: var(--space-1);
  --space-condensed: var(--space-2);
  --space-normal: var(--space-3);
  --space-spacious: var(--space-4);
  --space-loose: var(--space-6);
}
```

### Layout Grid

```css
:root {
  /* Container Widths */
  --container-sm: 640px;
  --container-md: 768px;
  --container-lg: 1024px;
  --container-xl: 1280px;
  --container-2xl: 1536px;
  
  /* Grid Gap */
  --grid-gap: var(--space-4);
  --grid-gap-lg: var(--space-6);
  
  /* Content Padding */
  --content-padding: var(--space-4);
  --content-padding-lg: var(--space-6);
}
```

---

## 5. Border & Radius

```css
:root {
  /* Border Widths */
  --border-width: 1px;
  --border-width-thick: 2px;
  
  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-full: 9999px;
  
  /* Semantic Radius */
  --radius-control: var(--radius-md);
  --radius-card: var(--radius-lg);
  --radius-modal: var(--radius-xl);
  --radius-button: var(--radius-md);
}
```

---

## 6. Shadows & Elevation

```css
:root {
  /* Shadow Scale */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  --shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  
  /* Elevation Levels */
  --elevation-low: var(--shadow-xs);
  --elevation-medium: var(--shadow-md);
  --elevation-high: var(--shadow-xl);
  --elevation-overlay: var(--shadow-2xl);
}
```

### Dark Mode Shadows

```css
[data-theme="dark"] {
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.3);
}
```

---

## 7. Component Patterns

### Buttons

```css
/* Base Button */
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  font: var(--text-body-sm);
  font-weight: 600;
  border-radius: var(--radius-button);
  border: var(--border-width) solid transparent;
  cursor: pointer;
  transition: all 150ms ease;
  min-height: 32px;
}

/* Variants */
.button-primary {
  background: var(--color-accent);
  color: var(--color-text-inverse);
  border-color: var(--color-accent);
}

.button-secondary {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-border-default);
}

.button-ghost {
  background: transparent;
  color: var(--color-text-primary);
  border-color: transparent;
}

/* Sizes */
.button-sm { padding: var(--space-1) var(--space-3); min-height: 28px; }
.button-md { padding: var(--space-2) var(--space-4); min-height: 32px; }
.button-lg { padding: var(--space-3) var(--space-5); min-height: 40px; }
```

### Inputs

```css
.input {
  display: block;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font: var(--text-body-md);
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: var(--border-width) solid var(--color-border-default);
  border-radius: var(--radius-control);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-muted);
}
```

### Cards

```css
.card {
  background: var(--color-surface);
  border: var(--border-width) solid var(--color-border-muted);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.card:hover {
  border-color: var(--color-border-default);
  box-shadow: var(--shadow-sm);
}

.card-elevated {
  box-shadow: var(--shadow-md);
  border-color: transparent;
}
```

### Modals

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--zIndex-modal);
}

.modal {
  background: var(--color-surface);
  border-radius: var(--radius-modal);
  box-shadow: var(--elevation-overlay);
  max-width: 480px;
  width: 100%;
  padding: var(--space-6);
}
```

---

## 8. Z-Index Scale

```css
:root {
  --zIndex-behind: -1;
  --zIndex-default: 0;
  --zIndex-sticky: 100;
  --zIndex-dropdown: 200;
  --zIndex-overlay: 300;
  --zIndex-modal: 400;
  --zIndex-popover: 500;
  --zIndex-toast: 600;
  --zIndex-skipLink: 700;
}
```

---

## 9. Animation & Motion

```css
:root {
  /* Duration */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --duration-slower: 500ms;
  
  /* Easing */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
  
  /* Semantic */
  --transition-colors: color var(--duration-normal) var(--ease-default),
                       background-color var(--duration-normal) var(--ease-default),
                       border-color var(--duration-normal) var(--ease-default);
  --transition-transform: transform var(--duration-normal) var(--ease-default);
  --transition-opacity: opacity var(--duration-normal) var(--ease-default);
  --transition-shadow: box-shadow var(--duration-normal) var(--ease-default);
}
```

---

## 10. Breakpoints & Responsive

```css
/* Mobile First Breakpoints */
:root {
  --breakpoint-sm: 640px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
  --breakpoint-2xl: 1536px;
}

/* Touch Targets */
:root {
  --touch-target: 44px;
  --touch-target-sm: 32px;
}
```

### Responsive Patterns

```css
/* Container Query */
.container {
  width: 100%;
  max-width: var(--container-xl);
  margin: 0 auto;
  padding: 0 var(--content-padding);
}

/* Grid System */
.grid {
  display: grid;
  gap: var(--grid-gap);
  grid-template-columns: 1fr;
}

@media (min-width: 768px) {
  .grid-cols-md-2 { grid-template-columns: repeat(2, 1fr); }
  .grid-cols-md-3 { grid-template-columns: repeat(3, 1fr); }
}

@media (min-width: 1024px) {
  .grid-cols-lg-4 { grid-template-columns: repeat(4, 1fr); }
}
```

---

## 11. Do's and Don'ts

### Do
- Use semantic tokens, never raw values
- Maintain 4px grid alignment
- Provide focus states for all interactive elements
- Support both light and dark themes
- Use consistent spacing scale
- Test with keyboard navigation
- Ensure 4.5:1 contrast ratio minimum

### Don't
- Mix border radius styles (pick one per component)
- Use color alone to convey information
- Create custom shadows outside the scale
- Override focus outlines without providing alternatives
- Use absolute pixel values for responsive layouts
- Animate layout properties (transform, opacity preferred)

---

## 12. Accessibility

### Color Contrast
- **Normal text**: 4.5:1 minimum
- **Large text** (18px+): 3:1 minimum
- **Interactive elements**: 3:1 against adjacent colors

### Focus Indicators
```css
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 13. Known Gaps

- Chart/data visualization colors not yet defined
- Email template styles not covered
- Marketing/landing page specific tokens pending
- Icon system needs integration
- Animation library selection pending

---

## References

- [GitHub Primer](https://primer.style)
- [Brave Leo](https://github.com/brave/leo)
- [Vercel Geist](https://vercel.com/design)
- [Shadcn/ui](https://ui.shadcn.com)
- [W3C Design Tokens](https://design-tokens.github.io/community-group/format/)

---

*Version: 1.0.0 | Last updated: 2026-09-08*