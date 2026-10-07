# Narrow-screen header layout

The authenticated header previously extended the native `Кабинет` link past
the 320px viewport. The nonshrinking brand, menu, notification button and
horizontal account icon/caption exceeded the available row width. Its grid
also stretched the region trigger. Global overflow clipping concealed both
without increasing the document's scroll width; a document-overflow check
alone did not validate this header.

Below the existing `sm` breakpoint (640px), the compact account link now places
its 28px icon above the complete 12px caption. The native link remains at least
44×44px, has no truncation or hidden caption, and keeps the same destination,
role/loading labels and keyboard behavior. At `sm` and above, the existing
horizontal 36px icon/14px caption composition remains. The already desktop-only
publish link retains its placement. The brand typography and wording remain.

The brand, notification button, region triggers, mobile menu links and desktop
navigation links have a minimum 44px hit height (the icon buttons also have a
44px width). This change does not alter authentication, notification counters,
menu state/focus logic or global overflow rules. It introduces no new row,
breakpoint, package, environment variable or external service.

## Regression verification

`tests/header-responsive-layout.test.mjs` executes the complete source modules
with real React/Next links/icons and the actual Tailwind compiler/config.
Only the unit Auth-state boundary is substituted; client effects do not run
in SSR. It covers public, signed-in, admin and loading labels, the mobile
layout, 640/768/1024/1440px composition, native destinations, 44px targets and
unchanged noncompact actions. Run with Node22:

```sh
node --test tests/header-responsive-layout.test.mjs
```

The disposable browser evidence is under
`tests/.artifacts/header-mobile-20261007/` (not intended for deployment).
`browser-layout.mjs` exercises normal UI login through the real Supabase SDK,
an explicit click in an isolated CAPTCHA vendor-boundary fixture, and native
Tab/Enter/Escape. Public, userA and admin roles are checked at 320, 375, 768,
1024 and 1440px. It measures every visible header interactive rectangle,
caption, pairwise overlap and keyboard focus in the actual production build,
including the open mobile menu. It never injects or reads session storage or
tokens. The fixture accepts only disposable synthetic Auth/token/logout and
read-only REST operations; server fetches and browser requests are confined
to the owned loopback app/fixture origins. No payment or production I/O runs.

`rendered-geometry.mjs` is a separate medium-size static SSR geometry control
for all four unit states, including loading, using the actual compiled CSS
and font stack. It executes no app/Auth scripts and makes no network requests;
it is not presented as a normal authenticated browser flow. Temporarily
replacing the mobile `flex-col` with `flex-row` via `apply_patch` must fail both
the CSS regression and the real geometry checks; restore the exact patch.

Synthetic Auth/CAPTCHA/REST verification does not establish live Supabase,
Cloudflare, RLS, delivery, payment or production configuration assurance.
