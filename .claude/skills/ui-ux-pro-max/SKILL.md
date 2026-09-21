---
name: ui-ux-pro-max
description: Comprehensive design intelligence and UI/UX engineering guidance across 22 technology stacks, 79 visual styles, color palettes, font pairings, chart types, GSAP animations, and 119 priority-ranked UX/accessibility rules. Use this skill when the task involves UI structure, visual design decisions, interaction patterns, accessibility audits, component creation/refactoring, or design system generation for web and mobile.
---

# UI/UX Pro Max - Design Intelligence

Comprehensive design intelligence and production-grade engineering guidance for web and mobile interfaces. Use this skill to make elite visual, structural, and interactive decisions, generate design systems, audit accessibility, and implement robust UI code.

## 1. Core Operating Principles & Priority Rules

When evaluating or designing any interface, follow these priority categories in order:

1. **Accessibility (a11y) & Inclusivity:** WCAG 2.1 AA/AAA compliance, minimum contrast ratios (4.5:1 for normal text, 3:1 for large text), keyboard navigation, screen reader support (`aria-*`, semantic HTML), and minimum touch targets ($44 \times 44\text{px}$).
2. **Visual Hierarchy & Layout Systems:** Gestalt principles (proximity, similarity, continuity), scannability (F-pattern and Z-pattern), consistent spacing scales (multipliers of 4px/8px), and robust responsive behavior (mobile-first grid systems).
3. **State Completeness:** Never design only the "happy path". Every interactive element and view must explicitly define:
   * `Default` / `Idle`
   * `Hover` / `Focus`
   * `Active` / `Pressed`
   * `Disabled`
   * `Loading` (Skeletons, spinners, optimistic updates)
   * `Empty` (Helpful illustrations, call-to-actions)
   * `Error` / `Validation` (Inline messages, recovery paths)
4. **Information Architecture & User Flow:** Reduce cognitive load, minimize friction in conversion funnels, and enforce clear progressive disclosure.
5. **Micro-Interactions & Motion:** Purposeful transitions (150ms–300ms duration, natural easing curves like `cubic-bezier(0.4, 0, 0.2, 1)`), avoiding layout shift (CLS), and rewarding user feedback.

---

## 2. Design System Generation Engine

When requested to create or recommend a design system based on a product type or keyword, synthesize tokens dynamically using the following matrices:

### A. Style Archetypes (Select based on brand identity)
* **Modern Clean / SaaS Minimal:** High whitespace, subtle borders (`border-slate-200`), neutral zinc/slate palettes, sans-serif typography (Inter/Geist), sharp or rounded-md corners.
* **Neumorphic / Soft UI:** Low-contrast shadows combining light and dark highlights (`box-shadow`), tactile cards, organic curves.
* **Glassmorphism / Frosted:** Backdrop filters (`backdrop-blur-md bg-white/7`), border transparency, layered depth with vibrant gradient backgrounds.
* **Cyberpunk / Neo-Brutalism:** High-contrast borders (`border-2 border-black`), raw solid accent colors (neon lime, hot pink), stark drop shadows without blur, expressive typography.
* **Editorial / Luxury:** Serif headings (Playfair Display, Merriweather), generous line heights, monochromatic contrast, sophisticated grid layouts.

### B. Technology Stack Specializations
Ensure all generated component patterns and code implementations adhere to the specific idioms of the target stack:
* **Web Stacks:** React, Next.js (App Router, Server Components), Vue 3 (Composition API), Svelte / SvelteKit, HTML / CSS (Vanilla / PostCSS).
* **Styling Ecosystems:** Tailwind CSS (v3/v4), shadcn/ui primitives, CSS Modules, Styled Components.
* **Mobile & Cross-Platform:** SwiftUI (iOS HIG), Jetpack Compose (Material Design 3), React Native / Expo, Flutter.

---

## 3. Comprehensive Component Library Guidelines

When designing or writing code for specific UI components, enforce these production requirements:

### Buttons & Actions
* Maintain distinct visual hierarchy: Primary (solid fill, high contrast), Secondary (outlined or subtle fill), Tertiary / Ghost (text only, hover background).
* Always include loading spinner states that preserve button dimensions to prevent layout shifts.

### Forms & Inputs
* Always associate `<label>` elements explicitly with inputs (`htmlFor` / `id`).
* Real-time validation should trigger on `blur` or after initial submission attempt, avoiding premature error states while typing.
* Support native input modes (`inputmode="numeric"`, `autocomplete="email"`, etc.) for optimal mobile keyboards.

### Tables & Data Grids
* Align data correctly: Text left-aligned, numbers and amounts right-aligned, status badges and dates centered.
* Include sticky headers for long scrollable tables, horizontal scrolling indicators on mobile, and pagination/virtualization options.

### Modals & Dialogs
* Implement strict focus trapping (Tab key cycles only within the modal).
* Support closing via `Escape` key and clicking backdrop overlays.
* Prevent background body scrolling (`overflow: hidden`) when open.

---

## 4. Output Generation Framework

When a user asks for a UI/UX review, design specification, or component implementation, structure your response professionally:

1. **UX Rationale & Strategy:** Explain *why* the proposed architecture or pattern solves the user problem and reduces friction.
2. **Design Token Specifications:** Define typography sizes, color hex codes / Tailwind utility classes, spacing tokens, and shadow properties.
3. **Component States & Edge Cases:** Outline how the component behaves across Loading, Empty, Error, and Success states.
4. **Production-Ready Code / Spec:** Deliver clean, semantic, accessible code (e.g., React + Tailwind CSS + shadcn/ui patterns) complete with ARIA attributes.

---

## 5. Gotchas & Anti-Patterns to Avoid
* **Never use pure black (`#000000`) on pure white (`#FFFFFF`) for body text** as it causes eye strain; prefer deep charcoal (`#0F172A` or `#18181B`) on soft light backgrounds.
* **Never rely solely on color to convey status** (e.g., red/green error indicators); always pair color changes with icons, explicit text messages, or patterns.
* **Avoid fixed font sizes in pixels (`px`) for body text**; use relative units (`rem`) to fully respect browser accessibility zoom settings.