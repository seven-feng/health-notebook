# Mobile Prototype Agent Guide

## Prototype Instructions

In ChatGPT Work Mode, run `sites-preview start "$PWD"`, open `http://terminal.local:4173/` in the cloud browser, and verify the rendered app and its primary interactions. Keep that preview open and tell the user to inspect it in the cloud browser; do not present the local URL as a user-facing chat link. In Codex Desktop, run the local server yourself, open the preview in the in-app browser, and provide the clickable local URL. Do not deploy to Sites unless the user explicitly asks to share, publish, or deploy. Do not give the user server-start instructions when you can run it.

Before planning or implementing any mobile-app change, read this `AGENTS.md` in full. It is the source of truth for the template's runtime and component guidance.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Editing Boundary

- Build app-specific UI in `src/Prototype.tsx` and `src/prototype.css`.
- Treat `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/mobile/`, `public/assets/iphone/`, `public/assets/android/`, `public/assets/status/`, `vite.config.ts`, `worker/index.js`, and `scripts/prepare-sites-build.mjs` as protected runtime files. Do not edit, replace, remove, or recreate them unless the user explicitly asks to change the mobile runtime itself. For an explicit runtime change, update the affected lock hashes only after verifying the new runtime behavior.
- Run `npm run check:runtime` before preview or handoff. If it fails, restore the protected runtime instead of weakening or bypassing the check.
- `npm run build` preserves the mobile runtime and prepares the static Cloudflare Worker output required by Sites. Before a Sites handoff, confirm `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json`, and source `.openai/hosting.json` exist, then run `npm run test:sites`. Do not replace this project with a Vinext starter.

## Runtime Contract

- Preserve the mobile device runtime unless the user's task explicitly asks otherwise. Do not replace it with a standalone page. Visual fidelity applies to app-owned content inside the device screen, not to template-owned device chrome.
- Keep `App` composed around `PhoneFrame` -> `KeyboardProvider`, with `StatusBar`, app content, `HomeIndicator`, and `KeyboardDock` mounted inside the phone frame. `StatusBar` and the iOS home indicator are overlaid device chrome. When the Android keyboard is closed, the app viewport reserves the protected navigation-bar region instead of painting behind it. When the Android keyboard is open, preserve the current full-screen keyboard layout: its asset includes the IME navigation strip and the separate black navigation bar is hidden. iOS screens continue to paint behind the home-indicator area and own their safe-area content padding.
- Preserve the `iPhone` / `Pixel 10` device picker and both calibrated device presets. The Pixel screen is `427 x 952`; its `32 x 32` camera circle and `public/assets/android/navigation-bar.svg` bottom navigation bar are protected device chrome, not app content.
- Preserve the device picker's intentionally lightweight Codex styling in the top-right corner: its trigger wrapper is borderless and transparent, its trigger sizes to content, and its right-aligned menu uses the compact 3px inset plus the specified hairline and elevation shadow layers. Keep the prototype root and default app screen white.
- Preserve `StatusBar` as live device chrome, including its platform-specific typography, source status-icon assets, and spacing. Pixel 10 uses Roboto, Android indicators, and 32px top, left, and right padding. iPhone uses its iOS indicators, system typography, and calibrated spacing. Do not hardcode screenshot times like `9:41` into the status bar, replace its real-time clock, or move status bar content into app markup unless the user explicitly asks for a fixed/mock device time.
- `PhoneFrame` owns the calibrated device frame, screen portal, device picker, camera cutout, and custom cursor. Keep device assets in `public/assets/iphone/` and `public/assets/android/`; if an asset fails to load, repair the asset path or restore the asset instead of removing the frame, keyboard, or image render.
- Use `MobileScroll` directly for simple single-screen prototypes. Use `FlowStack` for conventional multi-screen flows whose routes can own their fixed header and footer; when using it, define each route as a `FlowScreen`: `{ id, header?, headerHeight?, footer?, footerHeight?, render }`, and use `flow.push(screen)`, `flow.pop()`, and `flow.replace(screen)` from `FlowStack` render callbacks or `useFlow()` instead of introducing another router.
- Use `Carousel` for a carousel, horizontal rail, swipeable cards, image or media strip, horizontally scrollable cards, chip rail, or other horizontal collection.
- For a layered app shell—such as a persistent composer, independently presented sheet, pushed/peek sidebar, or app-wide transition—compose directly in `Prototype.tsx` rather than forcing it through `FlowStack`. Keep app-owned fixed chrome as sibling layers outside `MobileScroll`.
- When using `FlowScreen`, put route-owned fixed headers or footers in `FlowScreen.header` or `FlowScreen.footer`. Set `headerHeight` to the visible app-toolbar height; `FlowStack` adds the device's top safe-area/status-bar inset automatically. Do not include `StatusBar` or its height in the header. Set `footerHeight` to the full app-footer height. `FlowScreen.footer` is an overlay, not reserved layout space; screens using it must add their own bottom content padding such as `padding-bottom: calc(var(--flow-footer-height) + var(--mobile-safe-area-height) + 24px)` so final content can scroll above the footer while still painting behind it.
- Render only scrollable content inside `MobileScroll`; it is for content that should move with scroll and rubber-band overscroll. Keep app-owned headers, nav bars, tabs, composers, and overlays outside it. This keeps scroll physics, safe areas, keyboard insets, scrollbars, and drag click suppression active without letting content paint under fixed chrome.
- Buttons, links, cards, and images inside `MobileScroll` should still allow drag scrolling when the pointer moves beyond tap slop. Use `data-scroll-drag="ignore"` only for rare controls that must own the drag gesture themselves.
- Do not add `var(--keyboard-height)` to ordinary screen/content padding inside `MobileScroll`; the scroll viewport already shrinks above the simulated keyboard. For custom fixed composers, search bars, or toast chrome, use `useKeyboardInsets().bottomInset`. It is relative to the app viewport: Android returns `0` while the closed-keyboard viewport already reserves navigation, then returns the keyboard height while open; iOS continues to clear the home indicator while closed and ride directly above the keyboard while open. Do not pin custom bottom chrome to `bottom: 0` or only `keyboardHeight`.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for every text-entry control. A raw `input` or `textarea` disconnects focus, keyboard animation, safe-area insets, and attached surfaces.
- Use `BottomSheet` for phone-scoped sheets. Its props are `open`, `onOpenChange`, `title`, optional `description`, optional `snap`, and `children`; it renders through the phone screen portal and dismisses the keyboard before opening.

## Horizontal Carousels

- Use `Carousel` for horizontally draggable cards, images, media, chips, or other horizontal collections. Do not recreate these with `overflow-x`, custom pointer handlers, or a generic div.
- `Carousel` can be nested directly inside `MobileScroll`. It owns horizontal gestures and automatically yields vertical gestures to the parent.
- Never put `data-scroll-drag="ignore"` on or around a `Carousel`; doing so prevents vertical parent scrolling when a gesture begins inside it.
- Do not add CSS scroll snapping to `Carousel`; its runtime owns momentum and release motion.
- Use `data-scroll-drag="ignore"` only when a control must prevent parent scrolling in every drag direction.

See `src/mobile/COMPONENTS.md` for the full component and gesture contract.

## Keyboard Rule

The simulated keyboard is a separate top-layer component. Before presenting anything that behaves like iOS navigation or modal UI, dismiss it first.

Call `keyboard.hide()` before:

- pushing, popping, or replacing FlowStack routes
- opening bottom sheets, action sheets, dialogs, menus, or navigation sheets
- starting transitions where the destination should not inherit text-input focus

`FlowStack` already hides the keyboard for `push`, `pop`, and `replace`. `BottomSheet` already hides it before opening. If you add new modal/sheet/navigation primitives, follow the same rule.

When a composer, search surface, or other keyboard-attached component closes, call `keyboard.hide()` in the same event before changing that component's open state. Position attached surfaces from `useKeyboardInsets()` rather than a separate timer or visibility flag so both dismiss together.

When any text-entry control loses focus, dismiss the simulated keyboard. If the control is custom or does not use the runtime's keyboard-aware fields, handle its blur event and call `keyboard.hide()` explicitly. Keep the keyboard open only when focus is moving directly to another text-entry control that should share the same keyboard session.

## Interaction Rules

- Do not trigger buttons or inputs after a pointer has become a drag. Preserve the drag suppression behavior in `MobileScroll`.
- Do not allow native browser image/file dragging inside the phone frame. Preserve the phone-level `dragstart` suppression and non-draggable image styles so scroll drags that begin on images still scroll the prototype.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for text entry so the simulated keyboard and safe-area insets stay connected.
- Fixed phone chrome should not animate with pushed screens. Screen content can animate; the status bar, camera cutout, and preview chrome should stay put.
- Keep the keyboard below the home indicator/safe area layer in z-index, and above ordinary app UI while visible.
- Keep the home indicator as the topmost safe-area layer in the z-index above everything else in the prototype.

## Product decisions · 2026-10-23

- Default member is “我”. The member picker switches the entire active archive. Reports, pending review items, metrics and visits belong to the selected person only.
- Keep the original app's records/metrics/settings layout and green visual style. Add a compact member picker at the top right; do not add a separate family homepage or a global unassigned-report inbox.
- Imports belong to the current member. An OCR name mismatch prompts review; it must not automatically assign the report or switch the active archive.
- Member switching retains the current main tab. Detail/review pages inherit the report's owner; normal imports do not require choosing an owner again.
- Retain compact report/metric rows and hide scrollbars.

## First-use introduction · 2026-10-23

- Keep onboarding copy brief and focused on the free report-recognition / indicator-comparison workflow.
- Explain PDF import, camera recognition, and recognition from photos. Show factual numeric changes without interpreting health outcomes.
- The current onboarding exploration uses the existing green palette and app components. Keep it in the browser prototype until the user approves native implementation.

- Onboarding feature previews must use the actual native App interface (a verified screenshot or the real component), not a newly invented surrogate card. The earlier browser family prototype is not a fidelity reference for native screens. Label synthetic data as examples.

## Metrics exploration · 2026-10-23

- First reveal which latest results are outside their report's reference interval; show trend details on demand in compact expandable rows.
- Retain native green tokens, member scoping, per-result dates, and units next to names. In metric cards and expanded history, show only an up/down arrow beside out-of-range values; omit visible high/low/within labels. Preserve state descriptions for screen readers. Keep the top summary filter labels and each report's reference interval.
- Use only each report's stated reference range. Unknown ranges are a separate state; changing historical ranges must not be shown as one uniform band.
- This metrics revision remains a browser prototype with clearly marked synthetic data until approved for native implementation.

## Photo-to-visit prototype · 2026-10-23

- Dedicated browser entry: `?visit=1`; keep existing metrics, family, and onboarding routes intact.
- Use the native App's green tokens, system typography and compact white panels. This exploration extends the existing App, rather than replacing its style.
- Present visit date/hospital/department and three primary sections: chief complaint, recorded diagnosis, and recorded treatment/advice. Collapse history, past history and examination under “更多病历内容”.
- View the whole original or a field's original crop in a phone-scoped overlay; support pinch/double-click zoom and dragging, without plus/minus controls. Keep the original image entry lightweight.
- Fields can be edited directly without confirming every field individually. Saving creates a visit view with optional report association and a timeline entry.
- Use only fictional, explicitly marked demonstration content. Do not copy real medical photos or identifiers into public prototype assets. Recognition and storage in this prototype are simulated, session-only; native OCR implementation is a separate step.
- Give FlowStack scenes an app-owned opaque background to prevent underlying screens showing through during transitions.

## Integrated records homepage · 2026-10-23

- The user chose exactly two record views: “就诊记录” and “检验报告”. Do not add an “全部” view.
- Keep the existing homepage summary, PDF import, camera, album, family picker and bottom navigation. The shared import entry routes recognized outpatient notes to visit review and lab reports to indicator review; users do not choose a record type before capture.
- A visit card summarizes hospital/department/reason and counts of original notes/associated reports. Its detail contains those reports. The report view includes all reports, including those linked to a visit; association does not hide or duplicate a report there.
- Remember the last selected record view per member. For an unseen member with only reports, default to reports. Scope both views and link choices to that member.
- Do not automatically merge visits/reports based only on equal dates. Keep explicit associations.
- `?visit=1` now opens the integrated homepage, not a detached visit demo. Preserve the existing metrics and onboarding query entries.
- Example material selection inside the shared import sheet simulates photo/PDF recognition; it is not a proposed pre-capture type-selection step. Only view preference is persisted; fictional medical records reset on refresh.

## Confirmed visit details · 2026-10-24

- User feedback: once confirmed, each paragraph should no longer offer an image crop. The full visit needs a clearer reading hierarchy.
- Independent exploration at `?visit-detail=1`; existing prototype entries remain intact. This is a proposal, not approved native implementation.
- Consolidate date, hospital, department and member at the top. Show chief complaint, recorded diagnosis and advice in one continuous reading panel; emphasize the recorded diagnosis through typography, without generating conclusions or rewriting medical content.
- Keep one whole-original entry at the top, and an Edit action that re-enters the existing review flow. Collapse present/past history and examination together. Group explicitly associated lab reports below, followed by the user's own notes.
- Use fictional content and existing green tokens. Source viewing, report association and notes are session-only demonstrations; original images use existing synthetic assets.

## Whole-document deletion exploration · 2026-10-25

- User requested a redesign after finding no deletion entry for a PDF with extracted records. Keep this iteration in the browser prototype until native implementation is requested.
- `?delete=1` opens a whole-report example using the existing green UI. Keep the normal visit, metrics, onboarding and family routes available.
- Use a restrained destructive action at the bottom of the document overview and a concise confirmation sheet showing the member, filename and actual affected record counts. Source preview offers a management entry back to this overview.
- Demonstrate deletion and cancellation using resettable fictional records only. Independently sourced visits survive report deletion; only their links to deleted reports are removed. Source-owned visits, mixed records and storage errors are specified in the design document, not claimed as implemented native behavior.
